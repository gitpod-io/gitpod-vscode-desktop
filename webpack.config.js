//@ts-check

'use strict';

const path = require('path');
const webpack = require('webpack');
const packageJSON = require('./package.json')
const CopyPlugin = require('copy-webpack-plugin');

const daemonVersion = new webpack.DefinePlugin({
	'process.env.DAEMON_VERSION': JSON.stringify(packageJSON.daemonVersion ?? '0.0.1'),
});

/**@type {import('webpack').Configuration}*/
const prodConfig = {
	target: 'node',
	entry: {
		extension: './src/extension.ts',
		'local-ssh/proxy': './src/local-ssh/proxy.ts',
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

/**@type {import('webpack').Configuration}*/
const devConfig = {
	target: 'node',
	entry: {
		'local-ssh/proxy': './src/local-ssh/proxy.ts',
	},
	output: {
		path: path.resolve(__dirname, 'out'),
		filename: '[name].js',
		libraryTarget: "commonjs2",
		devtoolModuleFilenameTemplate: "../[resource-path]",
	},
	devtool: 'source-map',
	externals: {
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
		new CopyPlugin({
			patterns: [
				{ from: 'src/local-ssh/proxylauncher.bat', to: 'local-ssh/proxylauncher.bat' },
				{ from: 'src/local-ssh/proxylauncher.sh', to: 'local-ssh/proxylauncher.sh' },
			],
		}),
		daemonVersion,
	],
	watchOptions: {
		// for some systems, watching many files can result in a lot of CPU or memory usage
		// https://webpack.js.org/configuration/watch/#watchoptionsignored
		// don't use this pattern, if you have a monorepo with linked packages
		ignored: /node_modules/,
	},
}

module.exports = (_env, argv) => {
	if (argv.mode === 'development') {
		return devConfig;
	}

	return prodConfig;
};
