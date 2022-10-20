//@ts-check

const fs = require("fs");

const releasePackageJson = JSON.parse(fs.readFileSync('./package.json').toString());

const releaseDefaultConfig = new Map([
    ["gitpod.remote.useLocalApp", true],
]);

const gitpodConfig = releasePackageJson.contributes.configuration.find(e => e.title.toLowerCase() === 'gitpod');
for (const [setting, value] of releaseDefaultConfig) {
    gitpodConfig.properties[setting].default = value;
}

fs.writeFileSync('./package.release.json', JSON.stringify(releasePackageJson, undefined, '\t') + '\n');
