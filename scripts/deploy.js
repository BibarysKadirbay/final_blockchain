const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);
    const bal = await ethers.provider.getBalance(deployer.address);
    console.log("Balance ETH:", ethers.formatEther(bal));


    const Token = await ethers.getContractFactory("TestToken");
    const A = await Token.deploy("TokenA", "TKA");
    const B = await Token.deploy("TokenB", "TKB");
    const C = await Token.deploy("TokenC", "TKC");
    const D = await Token.deploy("TokenD", "TKD");

    await Promise.all([A.waitForDeployment(), B.waitForDeployment(), C.waitForDeployment(), D.waitForDeployment()]);

    const Pool = await ethers.getContractFactory("SimplePool");
    const feeBps = 30;

    const poolAB = await Pool.deploy(await A.getAddress(), await B.getAddress(), feeBps);
    const poolBC = await Pool.deploy(await B.getAddress(), await C.getAddress(), feeBps);
    const poolAC = await Pool.deploy(await A.getAddress(), await C.getAddress(), feeBps);

    await Promise.all([poolAB.waitForDeployment(), poolBC.waitForDeployment(), poolAC.waitForDeployment()]);

    const Agg = await ethers.getContractFactory("DexAggregator");
    const agg = await Agg.deploy();
    await agg.waitForDeployment();

    for (const t of [A, B, C, D]) {
        await (await agg.registerToken(await t.getAddress())).wait();
    }

    await (await agg.registerPool(await A.getAddress(), await B.getAddress(), await poolAB.getAddress())).wait();
    await (await agg.registerPool(await B.getAddress(), await C.getAddress(), await poolBC.getAddress())).wait();
    await (await agg.registerPool(await A.getAddress(), await C.getAddress(), await poolAC.getAddress())).wait();

    console.log("A:", await A.getAddress());
    console.log("B:", await B.getAddress());
    console.log("C:", await C.getAddress());
    console.log("D:", await D.getAddress());
    console.log("poolAB:", await poolAB.getAddress());
    console.log("poolBC:", await poolBC.getAddress());
    console.log("poolAC:", await poolAC.getAddress());
    console.log("Aggregator:", await agg.getAddress());
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
