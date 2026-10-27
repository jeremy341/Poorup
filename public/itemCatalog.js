// Shared presentation metadata. Instance values and eligibility are server owned.
export const ITEM_CATALOG = Object.freeze({
  'prison-key': Object.freeze({ id: 'prison-key', name: 'Prison Key', description: 'Leave prison before rolling using one Get Out of Prison card.', bankSellValue: 25, redeemValue: 0, actionLabel: 'Use', maturityRounds: 0 }),
  'parlor-bond': Object.freeze({ id: 'parlor-bond', name: 'Parlor Bond', description: 'Redeem for $100 after two rounds, or sell to the bank for $50.', bankSellValue: 50, redeemValue: 100, actionLabel: 'Redeem', maturityRounds: 2 }),
  'silver-keepsake': Object.freeze({ id: 'silver-keepsake', name: 'Silver Keepsake', description: 'A collectible worth $75 when sold to the bank.', bankSellValue: 75, redeemValue: 0, actionLabel: null, maturityRounds: 0 })
});
