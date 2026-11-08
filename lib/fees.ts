/** Fee a business pays (via OneKhusa) to publish one listing. Set PUBLISHING_FEE_MWK to change it. */
export function publishingFeeMwk(): number {
  const n = Number(process.env.PUBLISHING_FEE_MWK);
  return Number.isInteger(n) && n > 0 ? n : 10000;
}
