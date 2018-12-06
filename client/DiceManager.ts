import {Config, ViewState} from "./Config";
import {GUIManager} from "./GUIManager";
import {ViewStateObserver} from "./ViewStateObserver";
import {SocketMessage} from "../server/SocketMessage";

export class DiceManager extends ViewStateObserver {

    private selectors:any = {
        "betSlider": "#bet_slider",
        "betSliderContainer": "#bet_slider_container",
        "rollUnder": ".roll-under",
        "rollUnderButton": "#roll_under_button"
    };

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
        this.setupSlider();
    }

    protected attachGUIHandlers():void {

        super.attachGUIHandlers();

        // Listen for a new eos blockchain object
        $(document).on("updateEos", (event) => {
            this.eos = event.detail;
        });

        // Listen for new socketMessage
        $(document).on("updateSocketMessage", (event) => {
            this.socketMessage = <any> event.detail;
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

    private setupSlider():void {

        $(this.selectors.betSliderContainer).removeClass("d-none");

        $(this.selectors.betSlider).slider({
            "tooltip": "always",
            "tooltip_position": "bottom",
            "formatter": function(value:number) {
                return value.toString();
            }
        });

        $(this.selectors.betSlider).on("slide", (slideEvt:any) => {
            $(this.selectors.rollUnder).text(slideEvt.value);
        });

        $(this.selectors.rollUnder).text($(this.selectors.betSlider).val().toString());
    }
}