# AirVibe MQTT Manager - Deployment Feedback

This document outlines the steps taken, obstacles encountered, and solutions applied while setting up the AirVibe MQTT Manager on a Zorin OS Virtual Machine (running via VirtualBox) to connect to Actility ThingPark.

## Environment Context
* **OS:** Zorin OS (Linux VM)
* **Hypervisor:** VirtualBox (using Shared Folders for the source code)
* **Target Network Server:** Actility ThingPark
* **Network Setup:** VM has a static LAN IP (`192.168.1.175`), with the router port-forwarding external traffic on port `8883` to the VM.

## 1. Setup Script Execution (`setup_vps.sh`)
**Obstacle:** The setup script (`scripts/setup_vps.sh`) failed to run initially due to `\r` carriage return characters. This occurred because the repository was cloned on a Windows host and shared into the Linux VM via VirtualBox shared folders, preserving Windows CRLF line endings.
**Solution:** Re-configured `git` to use `autocrlf = input` and ran `git pull` to normalize the line endings to LF, allowing the bash script to execute properly.

## 2. Web UI Local Accessibility (Caddy TLS)
**Obstacle:** The desired configuration was to use a public IP (`24.92.108.175`) for `DOMAIN` in `.env` so that external services could route correctly. However, we needed to access the Web UI locally via the VM's LAN IP (`192.168.1.175`) to generate certificates. The `caddy/entrypoint.sh` script automatically attempts to fetch a Let's Encrypt certificate for the public `DOMAIN`, but this fails because port 80/443 were not forwarded to the VM. Furthermore, the local LAN IP wasn't present in the Caddyfile domains, resulting in SSL/TLS internal errors when browsing to `https://192.168.1.175`.
**Solution:** We modified `caddy/entrypoint.sh` to explicitly add the LAN IP and `localhost` to the Caddyfile logic, and attempted to force `tls internal`. *Note: Even after these changes, Caddy's internal ACME setup struggled inside the container environment without external routing, so we ultimately bypassed the UI and generated the certificates directly via a backend Node.js script.*

## 3. Backend Container Crash (`MODULE_NOT_FOUND`)
**Obstacle:** The `airvibe-manager-backend` container repeatedly crashed on startup with the error `Cannot find module '/app/src/index.js'`. 
**Root Cause:** Because the code was mounted via a VirtualBox shared folder, the file permissions mapping on the host strictly limited read access. The backend `Dockerfile` uses a non-root user (`nodeapp`) to run the application, but the `COPY . .` instruction replicated the restrictive host permissions into the image layer, preventing `nodeapp` from reading the source files.
**Solution:** Updated the backend `Dockerfile` to explicitly change ownership during the copy step:
```dockerfile
# Changed this:
COPY . .
# To this:
COPY --chown=nodeapp:nodeapp . .
```

## 4. Frontend Container Permissions
**Obstacle:** Similar to the backend, the `airvibe-manager-frontend` container had restrictive permissions on the `public` folder when copying from the builder stage.
**Solution:** Updated the frontend `Dockerfile` to ensure the `nextjs` user owns the public assets:
```dockerfile
# Changed this:
COPY --from=builder /app/public ./public
# To this:
COPY --from=builder --chown=nextjs:nextjs /app/public ./public
```

## 5. Mosquitto Broker Crash Loop (Permission Denied)
**Obstacle:** The `mqtt-broker` container entered a restart loop. The logs showed:
`Error: Unable to load CA certificates. Check cafile "/mosquitto/certs/ca.crt".`
`OpenSSL Error [0]: error:8000000D:system library::Permission denied`
**Root Cause:** Once again, VirtualBox shared folder permissions were the culprit. The certificates were correctly generated into `./certs` (which binds to `/mosquitto/certs`), but the Mosquitto process drops privileges to the `mosquitto` user, which was denied read access to these files mapped from the Windows host.
**Solution:** Modified the Mosquitto configuration templates to run as root within its isolated Docker container.
1. In `mosquitto/config/mosquitto.conf`, added `user root`.
2. In `mosquitto/watcher.sh`, added `user root` to the dynamically generated `mosquitto_nossl.conf` fallback block.
## 6. Frontend API URL Hardcoding (CORS Issues)
**Obstacle:** The user was accessing the frontend via `https://localhost` since they purposefully did not want to expose the Web UI via their public IP port forwarding. However, the frontend showed a persistent "Disconnected" status for the live MQTT data stream.
**Root Cause:** The `NEXT_PUBLIC_API_URL` environment variable was used extensively across the frontend React components to build the WebSocket connection URL. Because this env var was populated at *build time* using the public IP from `.env`, every browser session was instructed to connect to the public IP. When browsing from `localhost`, this cross-origin request was blocked by the browser.
**Solution:** Replaced instances of `process.env.NEXT_PUBLIC_API_URL` within the frontend source code with a dynamic check that falls back to the current window location (e.g., `typeof window !== 'undefined' ? window.location.origin : ...`) and rebuilt the container. This allowed the frontend to dynamically connect to the backend relative to the domain it is currently being accessed from.

## 7. ThingPark Device Routing & Auto-Discovery
**Obstacle:** After successfully establishing the MQTT connection, no devices or data appeared in the local AirVibe Manager UI, despite the devices being active within ThingPark.
**Root Cause:** There were two compounding factors:
1. **Unlinked Connection:** While the device and the MQTT connection both existed in ThingPark, the device was not explicitly assigned to route its uplinks to the newly created connection (the "Connections" field on the Device Profile was empty).
2. **Auto-Discovery Delay:** The AirVibe Manager backend relies on auto-discovery—it does not poll ThingPark for registered devices. It waits for the first uplink payload to arrive via MQTT to extract the `DevEUI` and populate the local database. Because the sensor was in a sleep cycle, no data was actively flowing.
**Solution:**
1. Edited the Device Profile in the ThingPark UI to explicitly select the new MQTT configuration in the "Connections" field.
2. Physically triggered the AirVibe sensor (via vibration) to force an immediate uplink transmission. Once this payload reached the backend, the device was instantly auto-discovered and appeared in the local UI.

## Summary of Recommendations for the Developer
1. **Line Endings:** Consider adding a `.gitattributes` file to force `text=auto eol=lf` on bash scripts (`*.sh`) so they are always checked out with Unix line endings, even on Windows hosts.
2. **Docker COPY Ownership:** Update the `Dockerfile` for both frontend and backend to use `--chown=...` on all `COPY` commands. This makes the containers vastly more resilient to restrictive host file permissions (e.g., VirtualBox mounts, strict CI/CD environments).
3. **Local Dev/Access Mode:** Consider implementing an explicit "Local Access" environment variable or fallback in the `caddy/entrypoint.sh` logic. When deploying to a server behind a NAT where port 80/443 cannot be exposed, it is difficult to access the Web UI securely without jumping through hoops to appease Let's Encrypt.
4. **Certificate Directory Permissions:** Document the required host permissions for the `./certs` folder, or consider having the mosquitto container startup script forcefully synchronize ownership/permissions into a docker-managed volume rather than relying directly on a bind-mount, which is notoriously fragile across different OS/Hypervisor setups.
5. **Dynamic Frontend API Routing:** The current frontend code bodes `NEXT_PUBLIC_API_URL` into the application bundle at build time. Consider updating the Next.js components to use relative paths (e.g. `/api` or `window.location.origin`) so that the application can be accessed via `localhost`, Lan IPs, or public domain names interchangeably without triggering CORS blocking or requiring a fresh Docker build.
6. **Detailed Setup Documentation:** Provide clearer onboarding instructions for the ThingPark side of the setup. Specifically, document that devices must be explicitly routed to the MQTT connection within ThingPark, and alert users that devices will not appear in the AirVibe Manager UI until their first post-setup uplink is received (requiring users to either wait for a scheduled transmission or manually trigger the sensor).
