const pki = require('/app/src/pki');
async function run() {
    await pki.generateCA('24.92.108.175');
    await pki.generateServerCert('24.92.108.175');
    const client = await pki.generateClientCert('thingpark');
    console.log("Client Cert Generated:", client.clientId);
}
run().catch(console.error);
