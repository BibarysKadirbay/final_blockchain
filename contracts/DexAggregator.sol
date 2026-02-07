// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISimplePool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getAmountOut(uint256 amountIn, address tokenIn) external view returns (uint256 amountOut);
    function swapExactIn(address tokenIn, uint256 amountIn, uint256 minOut, address to) external returns (uint256 amountOut);
}

contract DexAggregator is Ownable {
    mapping(address => mapping(address => address)) public poolOf;

    address[] public tokens;
    mapping(address => bool) public isToken;

    event PoolRegistered(address indexed tokenA, address indexed tokenB, address pool);
    event TokenRegistered(address indexed token);
    event RoutedSwap(address indexed user, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, address recipient, address[] path);

    constructor() Ownable(msg.sender) {}

    function registerToken(address token) external onlyOwner {
        require(token != address(0), "zero");
        require(!isToken[token], "exists");
        isToken[token] = true;
        tokens.push(token);
        emit TokenRegistered(token);
    }

    function registerPool(address tokenA, address tokenB, address pool) external onlyOwner {
        require(tokenA != tokenB, "same");
        require(tokenA != address(0) && tokenB != address(0), "zero");
        require(pool != address(0), "zero pool");

        poolOf[tokenA][tokenB] = pool;
        poolOf[tokenB][tokenA] = pool;

        emit PoolRegistered(tokenA, tokenB, pool);
    }

    function tokensCount() external view returns (uint256) {
        return tokens.length;
    }

    function _pool(address a, address b) internal view returns (address) {
        return poolOf[a][b];
    }

    function _quotePath(address[] memory path, uint256 amountIn) internal view returns (uint256) {
        uint256 out = amountIn;

        for (uint256 i = 0; i + 1 < path.length; i++) {
            address a = path[i];
            address b = path[i + 1];
            address p = _pool(a, b);
            if (p == address(0)) return 0;

            out = ISimplePool(p).getAmountOut(out, a);
            if (out == 0) return 0;
        }

        return out;
    }


    function quoteBest(address tokenIn, address tokenOut, uint256 amountIn)
        external
        view
        returns (address[] memory bestPath, uint256 bestOut)
    {
        require(tokenIn != address(0) && tokenOut != address(0), "zero");
        require(tokenIn != tokenOut, "same");
        require(amountIn > 0, "zero in");

        {
            address[] memory p2 = new address[](2);
            p2[0] = tokenIn;
            p2[1] = tokenOut;

            uint256 out2 = _quotePath(p2, amountIn);
            if (out2 > bestOut) {
                bestOut = out2;
                bestPath = p2;
            }
        }

        for (uint256 i = 0; i < tokens.length; i++) {
            address mid = tokens[i];
            if (mid == tokenIn || mid == tokenOut) continue;

            address[] memory p3 = new address[](3);
            p3[0] = tokenIn;
            p3[1] = mid;
            p3[2] = tokenOut;

            uint256 out3 = _quotePath(p3, amountIn);
            if (out3 > bestOut) {
                bestOut = out3;
                bestPath = p3;
            }
        }

        for (uint256 i = 0; i < tokens.length; i++) {
            address m1 = tokens[i];
            if (m1 == tokenIn || m1 == tokenOut) continue;

            for (uint256 j = 0; j < tokens.length; j++) {
                address m2 = tokens[j];
                if (m2 == tokenIn || m2 == tokenOut || m2 == m1) continue;
                
                address[] memory p4 = new address[](4);
                p4[0] = tokenIn;
                p4[1] = m1;
                p4[2] = m2;
                p4[3] = tokenOut;

                uint256 out4 = _quotePath(p4, amountIn);
                if (out4 > bestOut) {
                    bestOut = out4;
                    bestPath = p4;
                }
            }
        }

    }


    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 minOut,
        address[] calldata path,
        address recipient
    ) external returns (uint256 amountOutFinal) {
        require(recipient != address(0), "zero recipient");
        require(amountIn > 0, "zero in");
        require(path.length >= 2 && path.length <= 4, "bad path");
        require(path[0] != path[path.length - 1], "same");

        address tokenIn = path[0];
        address tokenOut = path[path.length - 1];

        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), "pull in");

        uint256 currentAmount = amountIn;

        for (uint256 i = 0; i + 1 < path.length; i++) {
            address a = path[i];
            address b = path[i + 1];

            address p = _pool(a, b);
            require(p != address(0), "no pool");

            IERC20(a).approve(p, 0);
            IERC20(a).approve(p, currentAmount);

            bool isLast = (i + 2 == path.length);
            address to = isLast ? recipient : address(this);
            uint256 hopMinOut = isLast ? minOut : 0;

            currentAmount = ISimplePool(p).swapExactIn(a, currentAmount, hopMinOut, to);
        }

        amountOutFinal = currentAmount;

        emit RoutedSwap(msg.sender, tokenIn, tokenOut, amountIn, amountOutFinal, recipient, _copyPath(path));
    }

    function _copyPath(address[] calldata path) internal pure returns (address[] memory m) {
        m = new address[](path.length);
        for (uint256 i = 0; i < path.length; i++) m[i] = path[i];
    }
}
