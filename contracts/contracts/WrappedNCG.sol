// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract WrappedNCG is ERC20, Ownable {
    event Burn(address indexed _sender, bytes32 indexed _to, uint256 amount);

    constructor() ERC20("Wrapped NCG", "wNCG") {}

    function burn(uint256 amount, bytes32 to) public {
        _burn(_msgSender(), amount);

        emit Burn(_msgSender(), to, amount);
    }

    function mint(address account, uint256 amount) public onlyOwner {
        _mint(account, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 2;
    }
}
