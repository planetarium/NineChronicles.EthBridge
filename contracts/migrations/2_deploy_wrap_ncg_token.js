const WrappedNCG = artifacts.require("WrappedNCG");

module.exports = function(deployer) {
  deployer.deploy(WrappedNCG);
};
