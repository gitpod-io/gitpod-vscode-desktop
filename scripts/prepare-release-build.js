//@ts-check

const fs = require("fs");

const releasePackageJson = JSON.parse(fs.readFileSync('./package.json').toString());

fs.writeFileSync('./package.release.json', JSON.stringify(releasePackageJson, undefined, '\t') + '\n');
