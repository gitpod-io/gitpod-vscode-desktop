const fs = require('fs');
const path = require('path');
const semver = require('semver');
const cp = require('child_process');
const packageJson = require('../package.json');

function install() {
    // bump up
    const version = new semver.SemVer(packageJson.version)
    version.inc('patch');
    packageJson.version = version.version;
    fs.writeFileSync(path.join(__dirname, '../package.json'), JSON.stringify(packageJson, null, '\t') + "\n");

    // install
    cp.execSync('yarn package')
    cp.execSync(`code --install-extension gitpod-desktop-${version.version}.vsix --force`)

    console.log(`Installed ${version.version} successfully! Reload window to make sure it's the latest version.`)
}

install();