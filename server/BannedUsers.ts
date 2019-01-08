import {DBManager} from "./DBManager";

export class BannedUsers {

    private dbManager:DBManager;
    private bannedIpAddresses:any;
    private bannedAccounts:any;

    constructor(dbManager:DBManager) {
        this.dbManager = dbManager;
        this.loadBannedUsersFromDB();
        setInterval(() => {
            this.loadBannedUsersFromDB();
        }, 30000);
    }

    public isBanned(accountName:string, ipAddress:string) {
        return this.bannedIpAddresses[ipAddress] || this.bannedAccounts[accountName];
    }

    private loadBannedUsersFromDB():Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            let bannedIpAddresses:any[] = await this.dbManager.getDocuments("bannedIpAddresses", {}, {}, 100000);
            this.bannedIpAddresses = {};
            for (let bannedIpAddress of bannedIpAddresses) {
                this.bannedIpAddresses[bannedIpAddress.ipAddress] = true;
            }
            let bannedAccounts:any[] = await this.dbManager.getDocuments("bannedAccounts", {}, {}, 100000);
            this.bannedAccounts = {};
            for (let bannedAccount of bannedAccounts) {
                this.bannedAccounts[bannedAccount.accountName] = true;
            }
        });
    }
}