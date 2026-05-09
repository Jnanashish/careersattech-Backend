const admin = require("firebase-admin");
const config = require("./index");

if (!admin.apps.length) {
    const serviceAccount = {
        type: "service_account",
        project_id: config.firebase.projectId,
        private_key_id: config.firebase.privateKeyId,
        private_key: config.firebase.privateKey,
        client_email: config.firebase.clientEmail,
        client_id: config.firebase.clientId,
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    };

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: config.firebase.projectId,
    });
}

module.exports = admin;
