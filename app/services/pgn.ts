export function preprocessPgn(pgn: string): string {
  return pgn.replace(/\}\s*\{/g, ' ');
}

export function isUserBlack(blackName: string): boolean {
  const name = blackName.toLowerCase();
  return name.includes('demanzonderjas') || name.includes('weustenraad');
}
