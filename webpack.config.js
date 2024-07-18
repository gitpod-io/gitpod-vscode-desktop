//@ts-check

'use strict';

const path = require('path');
const webpack = require('webpack');
const packageJSON = require('./package.json')
const CopyPlugin = require('copy-webpack-plugin');

const envPlugin = new webpack.DefinePlugin({
	'process.env.EXT_NAME': JSON.stringify('gitpod.gitpod-desktop'),
	'process.env.EXT_VERSION': JSON.stringify(packageJSON.version ?? '0.0.1'),
	'process.env.SEGMENT_KEY': JSON.stringify(packageJSON.segmentKey ?? ''),
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
		"node-rsa": "node-rsa",
		"@vscode/windows-ca-certs": "@vscode/windows-ca-certs"
	},
	resolve: {
		mainFields: ['main'],
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
		new webpack.IgnorePlugin({ contextRegExp: /node-fetch/, resourceRegExp: /^encoding$/ }),
		new CopyPlugin({
			patterns: [
				{ from: 'src/local-ssh/proxylauncher.bat', to: 'local-ssh/proxylauncher.bat' },
				{ from: 'src/local-ssh/proxylauncher.sh', to: 'local-ssh/proxylauncher.sh' },
			],
		}),
		envPlugin,
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
		"node-rsa": "node-rsa",
		"@vscode/windows-ca-certs": "@vscode/windows-ca-certs"
	},
	resolve: {
		mainFields: ['main'],
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
		new webpack.IgnorePlugin({ contextRegExp: /node-fetch/, resourceRegExp: /^encoding$/ }),
		new CopyPlugin({
			patterns: [
				{ from: 'src/local-ssh/proxylauncher.bat', to: 'local-ssh/proxylauncher.bat' },
				{ from: 'src/local-ssh/proxylauncher.sh', to: 'local-ssh/proxylauncher.sh' },
			],
		}),
		envPlugin,
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
