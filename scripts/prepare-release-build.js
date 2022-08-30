//@ts-check

const fs = require("fs");

const manifestPath = "./package.json";
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

const releaseConfig = new Map([
    ["gitpod.remote.useLocalApp", true],
    ["gitpod.remote.syncExtensions", false],
]);

for (const [setting, value] of releaseConfig) {
    manifest.contributes.configuration[0].properties[setting].default = value;
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");
