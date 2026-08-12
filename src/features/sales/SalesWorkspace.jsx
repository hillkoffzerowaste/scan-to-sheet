import React from 'react';
import { SalesWorkspace as SharedSalesWorkspace } from '@hillkoffzerowaste/sales-workspace';
import '@hillkoffzerowaste/sales-workspace/styles.css';
import { salesApi } from './api/salesApi.js';

export default function SalesWorkspace() {
  return <SharedSalesWorkspace adapter={salesApi} actorLabel="ผู้ใช้ Scan to Sheet" />;
}
