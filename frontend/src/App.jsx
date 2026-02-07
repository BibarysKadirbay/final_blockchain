import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";

import aggAbi from "./abi/DexAggregator.json";
import erc20Abi from "./abi/ERC20.json";
import { CONFIG } from "./config";

const short = (a) => (a ? a.slice(0, 6) + "..." + a.slice(-4) : "");

export default function App() {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState(null);

  const [tokenIn, setTokenIn] = useState("tokenA");
  const [tokenOut, setTokenOut] = useState("tokenC");
  const [amountIn, setAmountIn] = useState("1"); 
  const [slippagePct, setSlippagePct] = useState("1"); 

  const [balances, setBalances] = useState({});
  const [quote, setQuote] = useState({ path: [], out: 0n });
  const [status, setStatus] = useState("");

  const tokens = useMemo(() => {
    return [
      { key: "tokenA", name: "TokenA", address: CONFIG.contracts.tokenA },
      { key: "tokenB", name: "TokenB", address: CONFIG.contracts.tokenB },
      { key: "tokenC", name: "TokenC", address: CONFIG.contracts.tokenC },
      { key: "tokenD", name: "TokenD", address: CONFIG.contracts.tokenD },
    ];
  }, []);

  const tokenByKey = (k) => tokens.find((t) => t.key === k);

  const agg = useMemo(() => {
    if (!provider) return null;
    return new ethers.Contract(CONFIG.contracts.aggregator, aggAbi, provider);
  }, [provider]);

  const aggWithSigner = useMemo(() => {
    if (!signer) return null;
    return new ethers.Contract(CONFIG.contracts.aggregator, aggAbi, signer);
  }, [signer]);

  async function connect() {
    try {
      if (!window.ethereum) {
        alert("MetaMask не установлен");
        return;
      }
      const p = new ethers.BrowserProvider(window.ethereum);
      await p.send("eth_requestAccounts", []);
      const s = await p.getSigner();
      const a = await s.getAddress();
      const net = await p.getNetwork();

      setProvider(p);
      setSigner(s);
      setAccount(a);
      setChainId(Number(net.chainId));
      setStatus("");
    } catch (e) {
      setStatus(e.shortMessage || e.message);
    }
  }

  async function refreshBalances() {
    if (!provider || !account) return;

    const out = {};
    const ethBal = await provider.getBalance(account);
    out["ETH"] = ethers.formatEther(ethBal);

    for (const t of tokens) {
      const c = new ethers.Contract(t.address, erc20Abi, provider);
      let dec = 18;
      try {
        dec = Number(await c.decimals());
      } catch { }
      const bal = await c.balanceOf(account);
      out[t.name] = ethers.formatUnits(bal, dec);
    }
    setBalances(out);
  }

  async function doQuote() {
    if (!agg || !account) return;
    try {
      setStatus("Считаю quote...");

      const tIn = tokenByKey(tokenIn);
      const tOut = tokenByKey(tokenOut);
      if (!tIn || !tOut) return;

      const inToken = new ethers.Contract(tIn.address, erc20Abi, provider);
      let dec = 18;
      try {
        dec = Number(await inToken.decimals());
      } catch { }

      const amtIn = ethers.parseUnits(amountIn || "0", dec);

      const res = await agg.quoteBest(tIn.address, tOut.address, amtIn);
      const path = res[0];
      const outAmt = res[1];

      setQuote({ path, out: outAmt });
      setStatus("OK");
    } catch (e) {
      setStatus(e.shortMessage || e.message);
      setQuote({ path: [], out: 0n });
    }
  }

  async function approveIfNeeded(spender, tokenAddr, neededRaw) {
    const c = new ethers.Contract(tokenAddr, erc20Abi, signer);
    const allowance = await c.allowance(account, spender);
    if (allowance >= neededRaw) return;

    setStatus("Approve...");
    const tx = await c.approve(spender, neededRaw);
    setStatus("Approve tx: " + tx.hash);
    await tx.wait();
  }

  async function doSwap() {
    if (!aggWithSigner || !provider || !account) return;
    try {
      const tIn = tokenByKey(tokenIn);
      const tOut = tokenByKey(tokenOut);
      if (!tIn || !tOut) return;

      const inToken = new ethers.Contract(tIn.address, erc20Abi, provider);
      const outToken = new ethers.Contract(tOut.address, erc20Abi, provider);

      let decIn = 18, decOut = 18;
      try { decIn = Number(await inToken.decimals()); } catch { }
      try { decOut = Number(await outToken.decimals()); } catch { }

      const amtIn = ethers.parseUnits(amountIn || "0", decIn);

      let path = quote.path;
      let expectedOut = quote.out;

      if (!path.length || expectedOut === 0n) {
        const res = await agg.quoteBest(tIn.address, tOut.address, amtIn);
        path = res[0];
        expectedOut = res[1];
      }

      const slip = BigInt(Math.floor(Number(slippagePct || "0")));
      const minOut = expectedOut - (expectedOut * slip) / 100n;

      await approveIfNeeded(CONFIG.contracts.aggregator, tIn.address, amtIn);

      setStatus("Swap...");
      const tx = await aggWithSigner.swapExactTokensForTokens(
        amtIn,
        minOut,
        path,
        account
      );

      setStatus("Swap tx: " + tx.hash);
      await tx.wait();
      setStatus("Swap success ✅");

      await refreshBalances();
      await doQuote();
    } catch (e) {
      setStatus(e.shortMessage || e.message);
    }
  }

  useEffect(() => {
    if (!window.ethereum) return;

    const onChain = (hex) => setChainId(parseInt(hex, 16));
    const onAcc = (accs) => setAccount(accs?.[0] || "");

    window.ethereum.on("chainChanged", onChain);
    window.ethereum.on("accountsChanged", onAcc);

    return () => {
      window.ethereum.removeListener("chainChanged", onChain);
      window.ethereum.removeListener("accountsChanged", onAcc);
    };
  }, []);

  useEffect(() => {
    if (account && provider) {
      refreshBalances();
      doQuote();
    }
  }, [account, provider, tokenIn, tokenOut]);

  const chainOk = chainId && CONFIG.allowedChains[chainId];

  const prettyOut = useMemo(() => {
    const tOut = tokenByKey(tokenOut);
    if (!tOut || !provider) return "0";
    return quote.out ? quote.out.toString() : "0";
  }, [quote.out, tokenOut, provider]);

  return (
    <div style={{ maxWidth: 760, margin: "40px auto", fontFamily: "system-ui" }}>
      <h2>DEX Aggregator (Sepolia)</h2>

      <div style={{ padding: 16, border: "1px solid #ddd", borderRadius: 12, marginBottom: 16 }}>
        <button onClick={connect} style={{ padding: "10px 14px" }}>
          Connect MetaMask
        </button>

        <div style={{ marginTop: 10 }}>
          <div>Wallet: <b>{account ? short(account) : "not connected"}</b></div>
          <div>Network: <b>{chainId ? `${chainId} ${chainOk ? "(" + CONFIG.allowedChains[chainId].name + ")" : "(WRONG)"}` : "-"}</b></div>
        </div>

        {!chainOk && account && (
          <div style={{ marginTop: 10, color: "crimson" }}>
            Переключи сеть в MetaMask на <b>Sepolia (11155111)</b>
          </div>
        )}
      </div>

      <div style={{ padding: 16, border: "1px solid #ddd", borderRadius: 12, marginBottom: 16 }}>
        <h3>Balances</h3>
        <div>ETH: {balances.ETH ?? "-"}</div>
        <div>TokenA: {balances.TokenA ?? "-"}</div>
        <div>TokenB: {balances.TokenB ?? "-"}</div>
        <div>TokenC: {balances.TokenC ?? "-"}</div>
        <div>TokenD: {balances.TokenD ?? "-"}</div>
      </div>

      <div style={{ padding: 16, border: "1px solid #ddd", borderRadius: 12, marginBottom: 16 }}>
        <h3>Swap</h3>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div>Token In</div>
            <select value={tokenIn} onChange={(e) => setTokenIn(e.target.value)}>
              {tokens.map((t) => (
                <option key={t.key} value={t.key}>{t.name}</option>
              ))}
            </select>
          </div>

          <div>
            <div>Token Out</div>
            <select value={tokenOut} onChange={(e) => setTokenOut(e.target.value)}>
              {tokens.map((t) => (
                <option key={t.key} value={t.key}>{t.name}</option>
              ))}
            </select>
          </div>

          <div>
            <div>Amount In</div>
            <input value={amountIn} onChange={(e) => setAmountIn(e.target.value)} />
          </div>

          <div>
            <div>Slippage %</div>
            <input value={slippagePct} onChange={(e) => setSlippagePct(e.target.value)} />
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <button onClick={doQuote} style={{ padding: "10px 14px", marginRight: 10 }}>
            Quote best path
          </button>
          <button onClick={doSwap} style={{ padding: "10px 14px" }} disabled={!chainOk || !account}>
            Approve + Swap
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <div><b>Best path:</b> {quote.path?.length ? quote.path.map(short).join(" → ") : "-"}</div>
          <div><b>Estimated out (raw):</b> {quote.out?.toString?.() ?? "0"}</div>
        </div>
      </div>

      <div style={{ padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
        <h3>Status</h3>
        <div style={{ whiteSpace: "pre-wrap" }}>{status || "-"}</div>
      </div>
    </div>
  );
}
