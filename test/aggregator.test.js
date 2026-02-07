const { expect } = require("chai");
const { ethers } = require("hardhat");

const toWei = (n) => ethers.parseEther(String(n));

describe("DEX Aggregator MVP", function () {
    let owner, user;
    let A, B, C, D;
    let poolAB, poolBC, poolAC;
    let agg;

    async function addLiq(pool, t0, t1, signer, a0, a1) {
        await (await t0.connect(signer).approve(await pool.getAddress(), a0)).wait();
        await (await t1.connect(signer).approve(await pool.getAddress(), a1)).wait();
        await (await pool.connect(signer).addLiquidity(a0, a1)).wait();
    }

    beforeEach(async () => {
        [owner, user] = await ethers.getSigners();

        const Token = await ethers.getContractFactory("TestToken");
        A = await Token.deploy("TokenA", "TKA");
        B = await Token.deploy("TokenB", "TKB");
        C = await Token.deploy("TokenC", "TKC");
        D = await Token.deploy("TokenD", "TKD");
        await Promise.all([
            A.waitForDeployment(),
            B.waitForDeployment(),
            C.waitForDeployment(),
            D.waitForDeployment(),
        ]);

        const Pool = await ethers.getContractFactory("SimplePool");
        const feeBps = 30;

        poolAB = await Pool.deploy(await A.getAddress(), await B.getAddress(), feeBps);
        poolBC = await Pool.deploy(await B.getAddress(), await C.getAddress(), feeBps);
        poolAC = await Pool.deploy(await A.getAddress(), await C.getAddress(), feeBps);
        await Promise.all([poolAB.waitForDeployment(), poolBC.waitForDeployment(), poolAC.waitForDeployment()]);

        const Agg = await ethers.getContractFactory("DexAggregator");
        agg = await Agg.deploy();
        await agg.waitForDeployment();

        for (const t of [A, B, C, D]) {
            await (await agg.registerToken(await t.getAddress())).wait();
        }

        await (await agg.registerPool(await A.getAddress(), await B.getAddress(), await poolAB.getAddress())).wait();
        await (await agg.registerPool(await B.getAddress(), await C.getAddress(), await poolBC.getAddress())).wait();
        await (await agg.registerPool(await A.getAddress(), await C.getAddress(), await poolAC.getAddress())).wait();

        for (const t of [A, B, C, D]) {
            await (await t.mint(owner.address, toWei(1_000_000))).wait();
            await (await t.mint(user.address, toWei(10_000))).wait();
        }

        await addLiq(poolAB, A, B, owner, toWei(50_000), toWei(50_000));
        await addLiq(poolBC, B, C, owner, toWei(50_000), toWei(50_000));
        await addLiq(poolAC, A, C, owner, toWei(1_000), toWei(1_000));
    });

    it("quoteBest chooses 2-hop when better than direct", async () => {
        const amountIn = toWei(100);

        const [bestPath, out] = await agg.quoteBest(await A.getAddress(), await C.getAddress(), amountIn);

        expect(bestPath.length).to.equal(3);
        expect(bestPath[0]).to.equal(await A.getAddress());
        expect(bestPath[1]).to.equal(await B.getAddress());
        expect(bestPath[2]).to.equal(await C.getAddress());
        expect(out).to.be.gt(0n);
    });

    it("swapExactTokensForTokens works multi-hop", async () => {
        const amountIn = toWei(100);

        const [bestPathRO, expectedOut] = await agg.quoteBest(await A.getAddress(), await C.getAddress(), amountIn);

        const path = Array.from(bestPathRO);

        await (await A.connect(user).approve(await agg.getAddress(), amountIn)).wait();

        const balBefore = await C.balanceOf(user.address);
        const minOut = (expectedOut * 99n) / 100n;

        await expect(
            agg.connect(user).swapExactTokensForTokens(amountIn, minOut, path, user.address)
        ).to.emit(agg, "RoutedSwap");

        const balAfter = await C.balanceOf(user.address);
        expect(balAfter - balBefore).to.be.gte(minOut);
    });

    it("reverts on slippage if minOut too high", async () => {
        const amountIn = toWei(100);

        const [bestPathRO, expectedOut] = await agg.quoteBest(await A.getAddress(), await C.getAddress(), amountIn);

        const path = Array.from(bestPathRO);

        await (await A.connect(user).approve(await agg.getAddress(), amountIn)).wait();

        const minOutTooHigh = expectedOut + 1n;

        await expect(
            agg.connect(user).swapExactTokensForTokens(amountIn, minOutTooHigh, path, user.address)
        ).to.be.revertedWith("slippage");
    });
});
