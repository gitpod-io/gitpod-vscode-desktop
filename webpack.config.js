//@ts-check

'use strict';

const path = require('path');
const webpack = require('webpack');
const packageJSON = require('./package.json')
const CopyPlugin = require('copy-webpack-plugin');

const daemonVersion = new webpack.DefinePlugin({
	'process.env.DAEMON_VERSION': JSON.stringify(packageJSON.daemonVersion ?? '0.0.1'),
	'process.env.DAEMON_EXTENSION_VERSION': JSON.stringify(packageJSON.version),
});

/**@type {import('webpack').Configuration}*/
const config = {
	target: 'node',
	entry: {
		extension: './src/extension.ts',
		'local-ssh/client': './src/local-ssh/client.ts',
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
		"node-rsa": "node-rsa"
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
		new CopyPlugin({
			patterns: [
				{ from: 'src/local-ssh/proxylauncher.bat', to: 'local-ssh/proxylauncher.bat' },
				{ from: 'src/local-ssh/proxylauncher.sh', to: 'local-ssh/proxylauncher.sh' },
			],
		}),
		daemonVersion,
	]
}

module.exports = config;
