export interface IPlanetIds {
    odin: string;
    heimdall: string;
}

export interface IPlanetVaultAddress {
    heimdall: string;
}

const MAIN_PLANET_NAME = "odin";
type PlanetName = keyof IPlanetIds;

export class MultiPlanetary {
    private readonly _planetIds: IPlanetIds;
    private readonly _planetVaultAddresses: IPlanetVaultAddress;

    constructor(
        planetIds: IPlanetIds,
        planetVaultAddresses: IPlanetVaultAddress
    ) {
        this._planetIds = planetIds;
        this._planetVaultAddresses = planetVaultAddresses;
    }

    isMultiPlanetRequestType(_to: string): boolean {
        const multiPlanetIdRegex = /^[0-9]0{10}[0-9]$/;
        return multiPlanetIdRegex.test(_to.substring(2, 14));
    }

    getRequestPlanetName(_to: string): PlanetName {
        let planetName = MAIN_PLANET_NAME;

        if (!this.isMultiPlanetRequestType(_to)) {
            return MAIN_PLANET_NAME;
        }

        /**
         * If requestPlanetId is not in this._planetIds ( Invalid Multi-Planet Id )
         * Then send request to "odin".
         */
        for (const key of Object.keys(this._planetIds)) {
            if (_to.startsWith(this._planetIds[key as keyof IPlanetIds])) {
                planetName = key;
                break;
            }
        }

        return planetName as PlanetName;
    }

    isMainPlanetRequest(planetName: string): boolean {
        return planetName === MAIN_PLANET_NAME;
    }

    getPlanetVaultAddress(planetName: string): string {
        return this._planetVaultAddresses[
            planetName as keyof IPlanetVaultAddress
        ];
    }
}
