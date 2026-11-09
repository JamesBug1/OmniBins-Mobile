const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const config = {
	resolver: {
		blockList: [/[/\\]android[/\\](?:app[/\\])?(?:build|\.cxx)(?:[/\\]|$)/],
	},
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
