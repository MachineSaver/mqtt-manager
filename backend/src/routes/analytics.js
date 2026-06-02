const express = require('express');
const { pool } = require('../db');
const log = require('../logger').child({ module: 'analytics_api' });

const router = express.Router();

// GET /api/analytics/trends/:devEui
// Query params: from (ISO date), to (ISO date), limit
router.get('/trends/:devEui', async (req, res) => {
    try {
        const { devEui } = req.params;
        const { from, to, limit } = req.query;

        let query = `
            SELECT received_at, payload, payload_hex, fport
            FROM messages
            WHERE device_eui = $1 AND (
                fport IN (2, 7, 8, 9) OR 
                payload->>'packet_type' = '2' OR 
                payload->>'packet_type' = '7'
            )
        `;
        const params = [devEui];

        if (from) {
            params.push(from);
            query += ` AND received_at >= $${params.length}`;
        }
        if (to) {
            params.push(to);
            query += ` AND received_at <= $${params.length}`;
        }

        query += ` ORDER BY received_at DESC LIMIT $${params.length + 1}`;
        params.push(parseInt(limit) || 1000);

        const result = await pool.query(query, params);

        const trends = result.rows.map(row => {
            let p = row.payload || {};
            let trueTime = row.received_at;
            
            // Extract the true LoRaWAN gateway reception time if it exists in the payload wrapper
            if (p.DevEUI_uplink && p.DevEUI_uplink.Time) {
                const t = new Date(p.DevEUI_uplink.Time);
                if (!isNaN(t.getTime())) trueTime = t;
            } else if (p.rxInfo && p.rxInfo.length > 0 && p.rxInfo[0].time) {
                const t = new Date(p.rxInfo[0].time);
                if (!isNaN(t.getTime())) trueTime = t;
            } else if (p.time) {
                const t = new Date(p.time);
                if (!isNaN(t.getTime())) trueTime = t;
            }

            if (row.payload_hex && row.fport) {
                try {
                    const s = String(row.payload_hex || "").replace(/\s|0x/gi, "");
                    const bytes = [];
                    for (let i = 0; i < s.length; i += 2) bytes.push(parseInt(s.substring(i, i+2), 16));
                    
                    const decoded = require('../codec/AirVibe_TS013_Codec').decodeUplink({ bytes, fPort: row.fport });
                    if (decoded && decoded.data && (decoded.data.packet_type === 2 || decoded.data.packet_type === 7)) {
                        p = decoded.data;
                    }
                } catch (e) {}
            }
            return {
                timestamp: trueTime,
                temperature_c: p.temperature_c,
                is_machine_off: p.is_machine_off,
                accel_mg_rms: p.vibration && p.vibration.accel_mg_rms ? p.vibration.accel_mg_rms : undefined,
                velocity_mips_rms: p.vibration && p.vibration.velocity_mips_rms ? p.vibration.velocity_mips_rms : undefined,
                battery_voltage_v: p.battery && p.battery.voltage_v ? p.battery.voltage_v : undefined
            };
        }).filter(t => t.temperature_c !== undefined || t.is_machine_off !== undefined || t.accel_mg_rms !== undefined);
        
        // Sort descending by true extracted timestamp to fix graph chronological ordering
        trends.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        res.json(trends);
    } catch (err) {
        log.error({ err }, 'Error fetching trends');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/analytics/spectrums/:waveformId
router.get('/spectrums/:waveformId', async (req, res) => {
    try {
        const { waveformId } = req.params;

        const result = await pool.query(`
            SELECT spectrum_type, axis, resolution_hz, max_frequency_hz, data_bytes
            FROM waveform_spectrums
            WHERE waveform_id = $1
        `, [waveformId]);

        // Transform BYTEA into arrays of floats for the frontend
        const spectrums = result.rows.map(row => {
            const floats = new Float32Array(row.data_bytes.buffer, row.data_bytes.byteOffset, row.data_bytes.length / 4);
            return {
                type: row.spectrum_type,
                axis: row.axis,
                resolutionHz: row.resolution_hz,
                maxFrequencyHz: row.max_frequency_hz,
                data: Array.from(floats)
            };
        });

        res.json(spectrums);
    } catch (err) {
        log.error({ err }, 'Error fetching spectrums');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/analytics/waveforms/:devEui
// Lists completed waveforms for a device to populate the chart's TWF dropdown
router.get('/waveforms/:devEui', async (req, res) => {
    try {
        const { devEui } = req.params;
        const result = await pool.query(`
            SELECT id, transaction_id, start_time, metadata, expected_segments, received_segments_count
            FROM waveforms
            WHERE device_eui = $1 AND status = 'complete'
            ORDER BY start_time DESC
            LIMIT 50
        `, [devEui]);
        
        res.json(result.rows);
    } catch (err) {
        log.error({ err }, 'Error fetching device waveforms');
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
