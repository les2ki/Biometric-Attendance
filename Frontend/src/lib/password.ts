const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; // no look-alikes (0/O, 1/l/I)

export function generatePassword(length = 12): string { // temporary password (admin spec §8.1: 12 random chars)
  const bytes = new Uint32Array(length); // random numbers
  crypto.getRandomValues(bytes); // cryptographically secure randomness
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join(""); // map to readable characters
}
