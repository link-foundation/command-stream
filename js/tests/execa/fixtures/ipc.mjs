import { getOneMessage, sendMessage } from '../../../src/execa/index.mjs';
const message = await getOneMessage();
await sendMessage({ received: message });
