import assert from 'node:assert/strict';
import test from 'node:test';
import { marketplaceMetadata } from './normalize.js';

test('marketplaceMetadata keeps only the order number and unique non-empty SKUs', () => {
  assert.deepEqual(marketplaceMetadata({
    orderId: '  ORDER-123  ',
    items: [{ sku: ' SKU-A ' }, { sku: 'SKU-A' }, { sku: '' }, { sku: 'SKU-B' }],
  }), {
    marketplaceOrderId: 'ORDER-123',
    marketplaceSkus: ['SKU-A', 'SKU-B'],
  });
});

test('marketplaceMetadata returns null without an order number', () => {
  assert.equal(marketplaceMetadata({ items: [{ sku: 'SKU-A' }] }), null);
});
