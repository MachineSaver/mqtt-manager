const express = require('express');
const { pool } = require('../db');
const log = require('../logger').child({ module: 'hierarchy_api' });

const router = express.Router();

// --- HIERARCHY TREE READ --- //

router.get('/', async (req, res) => {
    try {
        const plantsRes = await pool.query('SELECT * FROM plants ORDER BY name');
        const areasRes = await pool.query('SELECT * FROM areas ORDER BY name');
        const sectorsRes = await pool.query('SELECT * FROM sectors ORDER BY name');
        const machinesRes = await pool.query('SELECT * FROM machines ORDER BY name');
        const componentsRes = await pool.query('SELECT * FROM components ORDER BY name');
        const sensorsRes = await pool.query('SELECT * FROM sensor_locations ORDER BY location_designation');
        
        // Find devices not yet assigned to any location
        const unassignedSensorsRes = await pool.query(`
            SELECT d.dev_eui 
            FROM devices d 
            LEFT JOIN sensor_locations sl ON d.dev_eui = sl.device_eui 
            WHERE sl.device_eui IS NULL
        `);

        // Build the tree in memory
        const tree = plantsRes.rows.map(plant => {
            return {
                ...plant,
                type: 'plant',
                children: areasRes.rows.filter(a => a.plant_id === plant.id).map(area => {
                    return {
                        ...area,
                        type: 'area',
                        children: sectorsRes.rows.filter(s => s.area_id === area.id).map(sector => {
                            return {
                                ...sector,
                                type: 'sector',
                                children: machinesRes.rows.filter(m => m.sector_id === sector.id).map(machine => {
                                    return {
                                        ...machine,
                                        type: 'machine',
                                        children: componentsRes.rows.filter(c => c.machine_id === machine.id).map(component => {
                                            return {
                                                ...component,
                                                type: 'component',
                                                children: sensorsRes.rows.filter(sn => sn.component_id === component.id).map(sensor => {
                                                    return {
                                                        ...sensor,
                                                        type: 'sensor'
                                                    }
                                                })
                                            }
                                        })
                                    }
                                })
                            }
                        })
                    }
                })
            }
        });

        // Append unassigned sensors directly to the root
        const unassignedNodes = unassignedSensorsRes.rows.map(row => ({
            id: `unassigned-${row.dev_eui}`,
            device_eui: row.dev_eui,
            location_designation: 'Unassigned Sensor',
            type: 'sensor'
        }));

        res.json([...tree, ...unassignedNodes]);
    } catch (err) {
        log.error({ err }, 'Error fetching hierarchy tree');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- GENERIC CRUD HELPERS --- //

const createCrudEndpoints = (tableName, parentIdColumn) => {
    // CREATE
    router.post(`/${tableName}`, async (req, res) => {
        const { name, description, parent_id } = req.body;
        try {
            let query, params;
            if (parentIdColumn) {
                query = `INSERT INTO ${tableName} (name, description, ${parentIdColumn}) VALUES ($1, $2, $3) RETURNING *`;
                params = [name, description || null, parent_id];
            } else {
                query = `INSERT INTO ${tableName} (name, description) VALUES ($1, $2) RETURNING *`;
                params = [name, description || null];
            }
            const result = await pool.query(query, params);
            res.json(result.rows[0]);
        } catch (err) {
            log.error({ err }, `Error creating ${tableName}`);
            res.status(500).json({ error: err.message });
        }
    });

    // UPDATE
    router.put(`/${tableName}/:id`, async (req, res) => {
        const { id } = req.params;
        const { name, description } = req.body;
        try {
            const result = await pool.query(
                `UPDATE ${tableName} SET name = $1, description = $2 WHERE id = $3 RETURNING *`,
                [name, description, id]
            );
            if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
            res.json(result.rows[0]);
        } catch (err) {
            log.error({ err }, `Error updating ${tableName}`);
            res.status(500).json({ error: err.message });
        }
    });

    // DELETE
    router.delete(`/${tableName}/:id`, async (req, res) => {
        const { id } = req.params;
        try {
            const result = await pool.query(`DELETE FROM ${tableName} WHERE id = $1 RETURNING id`, [id]);
            if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
            res.json({ success: true, deleted_id: id });
        } catch (err) {
            log.error({ err }, `Error deleting ${tableName}`);
            res.status(500).json({ error: err.message });
        }
    });
};

createCrudEndpoints('plants', null);
createCrudEndpoints('areas', 'plant_id');
createCrudEndpoints('sectors', 'area_id');
createCrudEndpoints('machines', 'sector_id');
createCrudEndpoints('components', 'machine_id');

// Sensor locations are slightly different (device_eui and location_designation instead of name)
router.post('/sensor_locations', async (req, res) => {
    const { component_id, device_eui, location_designation } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO sensor_locations (component_id, device_eui, location_designation) VALUES ($1, $2, $3) RETURNING *`,
            [component_id, device_eui, location_designation]
        );
        res.json(result.rows[0]);
    } catch (err) {
        log.error({ err }, 'Error assigning sensor');
        res.status(500).json({ error: err.message });
    }
});

router.put('/sensor_locations/:id', async (req, res) => {
    const { id } = req.params;
    const { device_eui, location_designation } = req.body;
    try {
        const result = await pool.query(
            `UPDATE sensor_locations SET device_eui = $1, location_designation = $2 WHERE id = $3 RETURNING *`,
            [device_eui, location_designation, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) {
        log.error({ err }, `Error updating sensor location`);
        res.status(500).json({ error: err.message });
    }
});

router.delete('/sensor_locations/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`DELETE FROM sensor_locations WHERE id = $1 RETURNING id`, [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true, deleted_id: id });
    } catch (err) {
        log.error({ err }, `Error deleting sensor location`);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
