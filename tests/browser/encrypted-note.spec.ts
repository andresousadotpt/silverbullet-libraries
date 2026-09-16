import { test, expect } from '@playwright/test';

const ui = (page: import('@playwright/test').Page) => page.frameLocator('iframe');

test('an encrypted note never renders until its passphrase authenticates the ciphertext', async ({ page }) => {
  await page.goto('/encrypted-note');
  const frame = ui(page);
  await expect(frame.getByLabel('Decrypted note')).toBeHidden();
  await frame.getByLabel('Passphrase', { exact: true }).fill('correct horse battery staple');
  await frame.getByLabel('Confirm passphrase').fill('correct horse battery staple');
  await frame.getByRole('button', { name: 'Create encrypted note' }).click();
  const content = frame.getByLabel('Decrypted note');
  await expect(content).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__encryptedHost.saved)).not.toBeNull();
  const emptyCiphertext = await page.evaluate(() => (window as any).__encryptedHost.saved as number[]);
  await content.fill('Private café');
  await expect.poll(async () => JSON.stringify(await page.evaluate(() => (window as any).__encryptedHost.saved)) !== JSON.stringify(emptyCiphertext)).toBe(true);
  const ciphertext = await page.evaluate(() => (window as any).__encryptedHost.saved as number[]);
  expect(new TextDecoder().decode(new Uint8Array(ciphertext))).not.toContain('Private café');

  await page.evaluate(bytes => (window as any).__encryptedHost.load(bytes), ciphertext);
  await expect(content).toBeHidden();
  await frame.getByLabel('Passphrase', { exact: true }).fill('wrong passphrase');
  await frame.getByRole('button', { name: 'Decrypt note' }).click();
  await expect(frame.getByRole('alert')).toContainText('Unable to decrypt');
  await expect(content).toBeHidden();

  await frame.getByLabel('Passphrase', { exact: true }).fill('correct horse battery staple');
  await frame.getByRole('button', { name: 'Decrypt note' }).click();
  await expect(content).toHaveValue('Private café');
});
