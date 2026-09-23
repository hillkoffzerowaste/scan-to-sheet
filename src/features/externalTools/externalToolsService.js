import { doc, onSnapshot, runTransaction } from 'firebase/firestore';
import { firestoreDb, serverTimestamp } from '../../services/firebase.js';
import { createExternalToolsService } from './externalToolsServiceCore.js';

const service = createExternalToolsService({
  db: firestoreDb,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
});

export const subscribeExternalTools = service.subscribeExternalTools;
export const saveExternalToolsConfig = service.saveExternalToolsConfig;
