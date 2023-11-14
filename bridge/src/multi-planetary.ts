export interface IPlanetIds {
    odin: string;
    heimdall: string;
}

export interface IPlanetVaultAddress {
    heimdall: string;
}

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
        let isMultiPlanetRequestType = false;

        for (const key of Object.keys(this._planetIds)) {
            if (_to.startsWith(this._planetIds[key as keyof IPlanetIds])) {
                isMultiPlanetRequestType = true;
                break;
            }
        }
        return isMultiPlanetRequestType;
    }

    getRequestPlanetName(_to: string): string {
        let planetName = "";

        if (!this.isMultiPlanetRequestType(_to)) {
            return "odin";
        }

        for (const key of Object.keys(this._planetIds)) {
            if (_to.startsWith(this._planetIds[key as keyof IPlanetIds])) {
                planetName = key;
                break;
            }
        }
        return planetName;
    }

    getPlanetVaultAddress(planetName: string): string {
        return this._planetVaultAddresses[
            planetName as keyof IPlanetVaultAddress
        ];
    }
}
