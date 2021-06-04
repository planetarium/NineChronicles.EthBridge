// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 ;

contract Migrations {
  address public owner;
  uint public lastCompetedMigration;

  modifier restricted() {
    if (msg.sender == owner) _;
  }

  constructor() {
    owner = msg.sender;
  }

  function setCompleted(uint completed) public restricted {
    lastCompetedMigration = completed;
  }
}
