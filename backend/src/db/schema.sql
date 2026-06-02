-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Waveforms Table
CREATE TABLE IF NOT EXISTS waveforms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_eui VARCHAR(50) NOT NULL,
    transaction_id INTEGER NOT NULL,
    session_id VARCHAR(100) GENERATED ALWAYS AS (device_eui || '_' || transaction_id) STORED, -- Logical grouping
    start_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending', -- pending, complete, failed, aborted
    expected_segments INTEGER,
    received_segments_count INTEGER DEFAULT 0,
    metadata JSONB, -- Sample rate, axis config, etc.
    final_data JSONB, -- Assembled waveform data
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_eui, transaction_id, start_time) -- Composite key to handle rollover, though start_time makes it tricky. 
    -- Better approach for rollover: We rely on the application to close/fail old transactions.
    -- For active ingestion, we query for status='pending' AND device_eui AND transaction_id.
);

-- Add requested_segments column (safe for existing databases)
ALTER TABLE waveforms ADD COLUMN IF NOT EXISTS requested_segments JSONB DEFAULT '[]';

-- Index for fast lookups of active transactions
CREATE INDEX IF NOT EXISTS idx_waveforms_active ON waveforms(device_eui, transaction_id) WHERE status = 'pending';

-- Segments Table
CREATE TABLE IF NOT EXISTS waveform_segments (
    waveform_id UUID REFERENCES waveforms(id) ON DELETE CASCADE,
    segment_index INTEGER NOT NULL,
    data BYTEA NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (waveform_id, segment_index)
);

-- Devices Table
CREATE TABLE IF NOT EXISTS devices (
    dev_eui VARCHAR(50) PRIMARY KEY,
    first_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_uplink_at TIMESTAMP WITH TIME ZONE,
    last_downlink_at TIMESTAMP WITH TIME ZONE,
    uplink_count INTEGER DEFAULT 0,
    downlink_count INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen DESC);

-- Messages Table
CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    device_eui VARCHAR(50) NOT NULL REFERENCES devices(dev_eui) ON DELETE CASCADE,
    topic VARCHAR(255) NOT NULL,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('uplink', 'downlink')),
    payload JSONB NOT NULL,
    payload_hex TEXT,
    fport INTEGER,
    packet_type SMALLINT,
    received_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_device_time ON messages(device_eui, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_direction_time ON messages(direction, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_time ON messages(received_at DESC);

-- Audit Log Table
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    source VARCHAR(30) NOT NULL,
    action VARCHAR(50) NOT NULL,
    device_eui VARCHAR(50),
    details JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_log_source ON audit_log(source);
CREATE INDEX IF NOT EXISTS idx_audit_log_device ON audit_log(device_eui) WHERE device_eui IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_time ON audit_log(created_at DESC);

-- FUOTA Sessions Table
CREATE TABLE IF NOT EXISTS fuota_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_eui VARCHAR(50) NOT NULL,
    firmware_name VARCHAR(255),
    firmware_size INTEGER NOT NULL,
    total_blocks INTEGER NOT NULL,
    status VARCHAR(30) DEFAULT 'pending',
    -- pending | initializing | waiting_ack | sending_blocks | verifying | resending | complete | failed | aborted
    blocks_sent INTEGER DEFAULT 0,
    verify_attempts INTEGER DEFAULT 0,
    last_missed_blocks JSONB DEFAULT '[]',
    error TEXT,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fuota_device_time ON fuota_sessions(device_eui, started_at DESC);

-- Add final_data_bytes column for BYTEA waveform storage (replaces JSONB hex in final_data)
ALTER TABLE waveforms ADD COLUMN IF NOT EXISTS final_data_bytes BYTEA;

-- Add persistence columns for restart recovery (safe for existing databases)
-- firmware_data: raw binary stored as BYTEA (TOAST-compressed by Postgres for large values).
--   NULL after session completes/fails/aborts to reclaim storage.
--   Used on startup to recover sessions orphaned by a backend restart.
-- block_interval_ms: per-session block interval preserved so recovery uses the same cadence.
ALTER TABLE fuota_sessions ADD COLUMN IF NOT EXISTS firmware_data BYTEA;
ALTER TABLE fuota_sessions ADD COLUMN IF NOT EXISTS block_interval_ms INTEGER;
-- original_class_info: stores the pre-FUOTA device class profile (ThingPark profileId +
-- deviceRef, or ChirpStack class string) at session start so recovery after a backend
-- restart can restore the correct Class A profile instead of the in-flight Class C one.
ALTER TABLE fuota_sessions ADD COLUMN IF NOT EXISTS original_class_info JSONB;

-- API Keys Table
-- Stores SHA-256 hashes of API keys — the raw key is never persisted.
CREATE TABLE IF NOT EXISTS api_keys (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key_hash    TEXT NOT NULL UNIQUE,
    label       VARCHAR(255) NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- Add FK from fuota_sessions to devices (safe on existing databases).
-- NOT VALID skips scanning historical rows; all future inserts are enforced.
-- ON DELETE RESTRICT prevents accidentally deleting a device that has FUOTA history.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fuota_sessions_device_fk'
    ) THEN
        ALTER TABLE fuota_sessions
            ADD CONSTRAINT fuota_sessions_device_fk
            FOREIGN KEY (device_eui) REFERENCES devices(dev_eui)
            ON DELETE RESTRICT
            NOT VALID;
    END IF;
END $$;

-- Predictive Monitoring Hierarchy Tables
CREATE TABLE IF NOT EXISTS plants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS areas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plant_id UUID NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(plant_id, name)
);

CREATE TABLE IF NOT EXISTS sectors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    area_id UUID NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(area_id, name)
);

CREATE TABLE IF NOT EXISTS machines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sector_id UUID NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(sector_id, name)
);

CREATE TABLE IF NOT EXISTS components (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(machine_id, name)
);

CREATE TABLE IF NOT EXISTS sensor_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    component_id UUID NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    device_eui VARCHAR(50) NOT NULL REFERENCES devices(dev_eui) ON DELETE CASCADE,
    location_designation VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(component_id, device_eui)
);

-- Spectrum Data Storage
CREATE TABLE IF NOT EXISTS waveform_spectrums (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    waveform_id UUID NOT NULL REFERENCES waveforms(id) ON DELETE CASCADE,
    spectrum_type VARCHAR(50) NOT NULL CHECK (spectrum_type IN ('velocity', 'acceleration', 'envelope')),
    axis VARCHAR(10) NOT NULL CHECK (axis IN ('axis_1', 'axis_2', 'axis_3')),
    resolution_hz DOUBLE PRECISION NOT NULL,
    max_frequency_hz DOUBLE PRECISION NOT NULL,
    data_bytes BYTEA NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(waveform_id, spectrum_type, axis)
);

