import { PublicKey } from "@solana/web3.js";

const authority = new PublicKey("7o64HNEkZZgTFa9fg2EWsS1stsbzUuZV9CziawESFUN1");
const programId = new PublicKey("5twpBNVkDu9YkuQ2aDRWTB1wvA4wjBu42Q42kn7Fy2G5");

const [policyPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("policy"), authority.toBuffer()],
  programId
);

console.log("Policy PDA:", policyPDA.toBase58());
