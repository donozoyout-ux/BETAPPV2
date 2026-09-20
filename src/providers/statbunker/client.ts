import { canStartHistoricalCollector } from '../../historical/provider-policy.js';

/** StatBunker collection deliberately has no page/API implementation until terms explicitly permit it. */
export class StatBunkerClient {
  startCollection() {
    if (!canStartHistoricalCollector('statbunker')) throw new Error('statbunker collection is disabled pending manual permission review');
  }
}
