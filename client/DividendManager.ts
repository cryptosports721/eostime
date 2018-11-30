import {SocketMessage} from "../server/SocketMessage";
import {GUIManager} from "./GUIManager";
import {ViewStateObserver} from "./ViewStateObserver";
import {Config} from "./Config";

export class DividendManager extends ViewStateObserver {

    private eos:any = null;
    private guiManager:GUIManager = null;
    private socketMessage:SocketMessage = null;
    private timeTokenSupply:number = 0.0;
    private timeTokenBalance:number = 0.0;
    private dividendBalance:number = 0.0;

    constructor(socketMessage:SocketMessage, guiManager:GUIManager) {
        super();
        this.socketMessage = socketMessage;
        this.guiManager = guiManager;
        this.attachSocketListeners();
    }

    /**
     * Listen to UI
     */
    protected attachGUIHandlers():void {
        super.attachGUIHandlers();

        // Listen for a new eos blockchain object
        $(document).on("updateEos", (event) => {
            this.eos = event.detail;
            if (this.eos) {
                this.eos.getTableRows(
                    {
                        code: Config.TIME_TOKEN_CONTRACT,
                        scope: Config.TIME_TOKEN_SYMBOL,
                        table: "stat",
                        json: true,
                    }
                ).then((timeTokenTable:any) => {
                    this.timeTokenSupply = parseFloat(timeTokenTable.rows[0].supply);
                    return this.eos.getAccount(Config.eostimeDividendContract);
                }).then((result:any) => {
                   this.dividendBalance = parseFloat(result.core_liquid_balance);
                   this.updateDividendFields();
                });
            }
        });
    }

    // ========================================================================
    // PROTECTED METHODS
    // ========================================================================

    protected setLoggedInView(account:any, accountInfo:any):void {
        super.setLoggedInView(account, accountInfo);
        this.eos.getCurrencyBalance(Config.TIME_TOKEN_CONTRACT, this.account.name, Config.TIME_TOKEN_SYMBOL).then((result:string[]) => {
            let coinBalance = result.find(currency => currency.indexOf(Config.TIME_TOKEN_SYMBOL) >= 0);
            if (coinBalance) {
                this.timeTokenBalance = parseFloat(coinBalance);
            }
            this.updateDividendFields();
        });
    }

    protected setLoggedOutView():void {
        super.setLoggedOutView();
        this.timeTokenBalance = 0.0;
        this.updateDividendFields();
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    private updateDividendFields():void {

    }

    /**
     * Attach our socket listeners
     */
    private attachSocketListeners():void {

    }
}