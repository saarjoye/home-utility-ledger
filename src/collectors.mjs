import { testSgccZhejiangConnection, collectSgccZhejiangBills } from "./connectors/sgcc-zhejiang.mjs";
import { testHzWaterConnection, collectHzWaterBills } from "./connectors/hzwater-online.mjs";
import { testHzGasConnection, collectHzGasBills } from "./connectors/hzgas-hangzhou.mjs";

const providerRegistry = {
  electricity: {
    testConnection: testSgccZhejiangConnection,
    collect: collectSgccZhejiangBills
  },
  water: {
    testConnection: testHzWaterConnection,
    collect: collectHzWaterBills
  },
  gas: {
    testConnection: testHzGasConnection,
    collect: collectHzGasBills
  }
};

function resolveCollector(account) {
  return providerRegistry[account.utilityType] || null;
}

export async function testAccountConnection(account, credentials) {
  const collector = resolveCollector(account);
  if (!collector?.testConnection) {
    throw new Error(`No connector is implemented for ${account.utilityType}/${account.provider}`);
  }
  return collector.testConnection({ account, credentials });
}

export async function collectAccountBills(account, credentials) {
  const collector = resolveCollector(account);
  if (!collector?.collect) {
    throw new Error(`No collector is implemented for ${account.utilityType}/${account.provider}`);
  }
  return collector.collect({ account, credentials });
}
