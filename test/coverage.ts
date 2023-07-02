import type {
	AfterSuiteRunMeta,
	CoverageProvider,
	CoverageProviderModule,
	ReportContext,
	ResolvedCoverageOptions,
	Vitest,
} from 'vitest';
import CoverageAPI from 'solidity-coverage/api';
import utils from 'solidity-coverage/utils';
import {HARDHAT_NETWORK_RESET_EVENT} from 'hardhat/internal/constants';
import PluginUI from '../utils/coverage/resources/nomiclabs.ui';
import nomiclabsUtils from '../utils/coverage/resources/nomiclabs.utils';
import fs from 'fs';
import type {EIP1193ProviderWithoutEvents} from 'eip-1193';
import {HardhatRuntimeEnvironment} from 'hardhat/types';

export async function setupProviderWithCoverageSupport(env: HardhatRuntimeEnvironment): Promise<{
	api: CoverageAPI;
	config: any;
	provider: EIP1193ProviderWithoutEvents;
}> {
	// TODO args like compile-for-coverage
	const args = {};

	const config = nomiclabsUtils.normalizeConfig(env.config, args);
	const ui = new PluginUI(config.logger.log);
	// TODO solccover file: api = new API(utils.loadSolcoverJS(config));
	const api = new CoverageAPI(config);
	// const data = JSON.parse(fs.readFileSync('coverage-data.json', 'utf-8'));
	// api.setInstrumentationData(data);
	let {targets, skipped} = utils.assembleFiles(config, []);
	targets = api.instrument(targets);

	let network = await nomiclabsUtils.setupHardhatNetwork(env, api, ui);

	const accounts = await utils.getAccountsHardhat(network.provider);
	const nodeInfo = await utils.getNodeInfoHardhat(network.provider);

	// Note: this only works if the reset block number is before any transactions have fired on the fork.
	// e.g you cannot fork at block 1, send some txs (blocks 2,3,4) and reset to block 2
	network.provider.on(HARDHAT_NETWORK_RESET_EVENT, async () => {
		await api.attachToHardhatVM(network.provider);
	});

	await api.attachToHardhatVM(network.provider);

	ui.report('hardhat-network', [nodeInfo.split('/')[1], env.network.name]);

	// Set default account (if not already configured)
	nomiclabsUtils.setNetworkFrom(network.config, accounts);

	// Run post-launch server hook;
	await api.onServerReady(config);

	nomiclabsUtils.collectTestMatrixData(args, env, api);

	const provider = (() => {
		async function request(args: {method: string; params?: any[]}) {
			const result = await network.provider.request(args);

			const data = api.getInstrumentationData();
			fs.writeFileSync('coverage-data.json', JSON.stringify(data, null, 2));
			return result;
		}
		return new Proxy(network.provider, {
			get(target, p) {
				if (p === 'request') {
					return request;
				}
				return target[p];
			},
		});
	})();

	return {
		api,
		config,
		provider,
	};
}