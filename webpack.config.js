//@ts-check

'use strict';

const path = require('path');
const webpack = require('webpack');
const packageJSON = require('./package.json')

const daemonVersion = new webpack.DefinePlugin({
	'process.env.DAEMON_VERSION': JSON.stringify(packageJSON.version),
});

/**@type {import('webpack').Configuration}*/
const config = {
	target: 'node',
	entry: {
		extension: './src/extension.ts',
		'local-ssh/daemon': './src/local-ssh/daemon.ts',
	},
	output: {
		path: path.resolve(__dirname, 'out'),
		filename: '[name].js',
		libraryTarget: "commonjs2",
		devtoolModuleFilenameTemplate: "../[resource-path]",
	},
	devtool: 'source-map',
	externals: {
		vscode: "commonjs vscode",
		bufferutil: "bufferutil",
		"utf-8-validate": "utf-8-validate",
	},
	resolve: {
		extensions: ['.ts', '.js']
	},
	module: {
		rules: [{
			test: /\.ts$/,
			exclude: /node_modules/,
			use: [{
				loader: 'ts-loader'
			}]
		}]
	},
	plugins: [
		new webpack.IgnorePlugin({
			resourceRegExp: /crypto\/build\/Release\/sshcrypto\.node$/,
		}),
		new webpack.IgnorePlugin({
			resourceRegExp: /cpu-features/,
		}),
		daemonVersion,
	]
}

module.exports = config;
