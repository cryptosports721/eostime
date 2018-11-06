export class ConfigBase {

    constructor() {
    }

    public static minBet:number = 0.1;
    public static maxBet:number = 5.0;

    /**
     * Returns the first public key from the accountInfo structure that has the permission "active"
     * @returns {string}
     */
    public static firstActivePublicKeyFromAccountInfo(accountInfo:any):string {
        let publicKey:string = null;
        let permissions:any[] = ConfigBase.safeProperty(accountInfo, ["permissions"], null);
        if (permissions) {
            let permission:any = permissions.find((val:any) => {
                return val.perm_name == "active";
            });
            let keys:any[] = ConfigBase.safeProperty(permission,["required_auth.keys"], null);
            if (keys && keys.length > 0) {
                let key:any = keys[0];
                publicKey = ConfigBase.safeProperty(key, ["key"], null);
            }
        }
        return publicKey;
    }

    /**
     * Returns a specific property of an object if it exists and
     * is non-null - otherwise a default value.
     * @param obj
     * @param {string[]} prop
     * @param def
     * @returns {any}
     */
    public static safeProperty(obj:any, prop:string[], def:any):any {

        if ((typeof obj == "undefined") || (obj === null)) {
            return def;
        } else {
            for (let i: number = 0; i < prop.length; i++) {
                let o: any = obj;
                let parts: string[] = prop[i].split(".");
                for (let j: number = 0; j < parts.length; j++) {
                    let part: string = parts[j];
                    if (o.hasOwnProperty(part) && (o[part] !== null)) {
                        o = o[part];
                    } else {
                        // Bad property
                        o = null;
                        break;
                    }
                }
                if (o !== null) {
                    // All good, return the property
                    return o;
                }
            }

            // No valid properties
            return def;
        }
    }
}