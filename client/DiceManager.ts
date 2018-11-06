import {Config, ViewState} from "./Config";
import {GUIManager} from "./GUIManager";
import {ViewStateObserver} from "./ViewStateObserver";
import {SocketMessage} from "../server/SocketMessage";

export class DiceManager extends ViewStateObserver {

    private eos:any = null;
    private guiManager:any = null;
    private socketMessage:SocketMessage = null;

    /**
     * Constructs our Dice game manager
     */
    constructor(socketMessage:SocketMessage, guiManager:GUIManager) {
        super();
        this.socketMessage = socketMessage;
        this.guiManager = guiManager;
    }

    protected attachGUIHandlers():void {

        super.attachGUIHandlers();

        // Listen for a new eos blockchain object
        $(document).on("updateEos", (event) => {
            this.eos = event.detail;
        });

        // Listen for
        $(document).on("rollUnder", (event) => {

            if (this.account) {

                let payload: any = event.detail;
                let rollUnder: number = payload.rollUnder;
                let betAmount: number = payload.betAmount;

                if (betAmount < Config.minBet || betAmount > Config.maxBet) {
                    // TODO Reflect a user message here
                    return;
                }

                alert(rollUnder + " / " + betAmount);

                const contractAccount: string = "ghassett1111";
                const assetAndQuantity: string = "0.5000 EOS";
                const diceMemo: string = "";
                const options = {authorization: [`${this.account.name}@${this.account.authority}`]};

                this.eos.transfer(this.account.name, contractAccount, assetAndQuantity, diceMemo, options).then((result) => {
                    console.log(result);
                }).catch(err => {
                    console.log(err);
                });
            }

        });
    }
}