//SPDX-LIcense-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SimplePool{
    address public immutable token0;
    address public immutable token1;

    uint256 public reserve0;
    uint256 public reserve1;

    uint256 public immutable feeBps;
    uint256 public totalLiquidity;
    mapping(address =>uint256) public liquidityOf;

    event LiquidityAdded(address indexed provider, uint256 amount0, uint256 amount1, uint256 liquidityMinted);
    event LiquidityRemoved(address indexed provider, uint256 amount0, uint256 amount1, uint256 liquidityBurned);
    event Swapped(address indexed sender, address indexed tokenIn, uint256 amountIn, address indexed tokenOut, uint256 amountOut, address to);

    constructor(address _token0, address _token1, uint256 _feeBps) {
        require(_token0 != _token1, "same token");
        require(_token0 != address(0) && _token1 != address(0), "zero");
        require(_feeBps < 10_000, "bad fee");

        token0 = _token0;
        token1 = _token1;
        feeBps = _feeBps;
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = (y / 2) + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    function _updateReserves(uint256 newR0, uint256 newR1) internal {
        reserve0 = newR0;
        reserve1 = newR1;
    }

    function addLiquidity(uint256 amount0, uint256 amount1) external returns (uint256 liquidityMinted) {
        require(amount0 > 0 && amount1 > 0, "zero amounts");

        require(IERC20(token0).transferFrom(msg.sender, address(this), amount0), "t0 tf");
        require(IERC20(token1).transferFrom(msg.sender, address(this), amount1), "t1 tf");

        if (totalLiquidity == 0) {
            liquidityMinted = _sqrt(amount0 * amount1);
            require(liquidityMinted > 0, "liq=0");
        } else {
            uint256 liq0 = (amount0 * totalLiquidity) / reserve0;
            uint256 liq1 = (amount1 * totalLiquidity) / reserve1;
            liquidityMinted = _min(liq0, liq1);
            require(liquidityMinted > 0, "liq=0");
        }

        liquidityOf[msg.sender] += liquidityMinted;
        totalLiquidity += liquidityMinted;

        _updateReserves(reserve0 + amount0, reserve1 + amount1);

        emit LiquidityAdded(msg.sender, amount0, amount1, liquidityMinted);
    }

    function removeLiquidity(uint256 liquidity) external returns (uint256 amount0Out, uint256 amount1Out) {
        require(liquidity > 0, "zero");
        require(liquidityOf[msg.sender] >= liquidity, "not enough");

        amount0Out = (reserve0 * liquidity) / totalLiquidity;
        amount1Out = (reserve1 * liquidity) / totalLiquidity;

        liquidityOf[msg.sender] -= liquidity;
        totalLiquidity -= liquidity;

        _updateReserves(reserve0 - amount0Out, reserve1 - amount1Out);

        require(IERC20(token0).transfer(msg.sender, amount0Out), "t0 out");
        require(IERC20(token1).transfer(msg.sender, amount1Out), "t1 out");

        emit LiquidityRemoved(msg.sender, amount0Out, amount1Out, liquidity);
    }

    function getAmountOut(uint256 amountIn, address tokenIn) public view returns (uint256 amountOut) {
        require(amountIn > 0, "zero in");
        require(tokenIn == token0 || tokenIn == token1, "bad token");

        (uint256 rIn, uint256 rOut) = tokenIn == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
        require(rIn > 0 && rOut > 0, "no liq");

        uint256 amountInWithFee = amountIn * (10_000 - feeBps) / 10_000;
        amountOut = (amountInWithFee * rOut) / (rIn + amountInWithFee);
    }

    function swapExactIn(address tokenIn, uint256 amountIn, uint256 minOut, address to)
        external
        returns (uint256 amountOut)
    {
        require(to != address(0), "zero to");
        require(amountIn > 0, "zero in");
        require(tokenIn == token0 || tokenIn == token1, "bad token");

        address tokenOut = tokenIn == token0 ? token1 : token0;

        amountOut = getAmountOut(amountIn, tokenIn);
        require(amountOut >= minOut, "slippage");

        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), "in tf");

        require(IERC20(tokenOut).transfer(to, amountOut), "out tf");

        if (tokenIn == token0) {
            _updateReserves(reserve0 + amountIn, reserve1 - amountOut);
        } else {
            _updateReserves(reserve0 - amountOut, reserve1 + amountIn);
        }

        emit Swapped(msg.sender, tokenIn, amountIn, tokenOut, amountOut, to);
    }
    
}