const WrappedNCGToken = artifacts.require("WrappedNCGToken");

module.exports = function(deployer) {
  deployer.deploy(WrappedNCGToken);
};
