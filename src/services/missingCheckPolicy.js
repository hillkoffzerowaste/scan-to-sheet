export function shouldPollMissingOrders({ isSignedIn, activeTab }) {
  return Boolean(isSignedIn && activeTab === 'drive');
}
