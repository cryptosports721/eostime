///<reference path="../node_modules/@types/jquery/index.d.ts" />
import {Config, ViewState} from "./Config";
import {ViewStateObserver} from "./ViewStateObserver";

export enum EOS_NETWORK {
    MAINNET = 0,
    JUNGLE
}

export class GUIManager extends ViewStateObserver {

    private selectors:any = {
        "developerMode": ".developer-mode",
        "networkMenuContainer": "#network_selector_containerr",
        "networkMenuDropdown": "#network_selector",
        "mainNetSelected": "#select_mainnet",
        "jungleSelected": "#select_jungle",
        "publicKey": ".public-key",
        "accountName": ".account-name",
        "devErrorMessageContainer": "#dev_error_message_container",
        "devErrorMessage": ".dev-error-message",
        "devErrorMessageRowTemplate": ".dev-error-message-row-template",
        "clearDevErrors": ".dev-clear-errors",
        "betSlider": "#bet_slider",
        "betSliderContainer": "#bet_slider_container",
        "rollUnder": ".roll-under",
        "rollUnderButton": "#roll_under_button",
        "loginButton": ".login-button",
        "logoutButton": ".logout-button",
        "loggedOutView": ".logged-out-view",
        "loggedInView": ".logged-in-view",
        "uiBlocker": ".uiBlocker",
        "eosBalance": ".eos-balance",
        "betAmount": "#bet_amount"
    }

    constructor() {
        super();
        this.attachEventHandlers();
        this.setupSlider();
    }

    // ========================================================================
    // PUBLIC METHODS
    // ========================================================================

    public enableDevGui():void {
        $(this.selectors.developerMode).removeClass("d-none");
    }

    public blockUI(block:boolean):void {
        if (block) {
            $(this.selectors.uiBlocker).removeClass("d-none");
        } else {
            $(this.selectors.uiBlocker).addClass("d-none");
        }
    }

    public onClearDevErrors():void {
        $(this.selectors.devErrorMessageContainer).empty();
    }

    public onDevError(err:string):void {
        $(this.selectors.clearDevErrors).empty().removeClass("clearDevErrors");
        let $clone:JQuery<HTMLElement> = $(this.selectors.devErrorMessageRowTemplate).clone().removeClass(this.selectors.devErrorMessageRowTemplate.substr(1)).removeClass("d-none");
        $clone.find(this.selectors.devErrorMessage).html(err);
        $clone.find(this.selectors.clearDevErrors).html("<span>clear</span>");
        $clone.find(this.selectors.clearDevErrors + " span").on("click", (event) => {
            $(this.selectors.devErrorMessageContainer).empty();
        });
        $(this.selectors.devErrorMessageContainer).append($clone);
    }

    public onError(err:string):void {
        // TODO HANDLE ERROR MESSAGES IN USER GUI
    }

    public setNetworkMenu(val:string):void {
        $(this.selectors.networkMenuDropdown).text(val);
    }

    public updateConnectedNetwork(val:EOS_NETWORK):void {
        switch (val) {
            case EOS_NETWORK.JUNGLE:
                $(this.selectors.networkMenuDropdown).text("Jungle");
                break;
            case EOS_NETWORK.MAINNET:
                $(this.selectors.networkMenuDropdown).text("MainNet");
                break;
        }
    }

    public setPublicKey(val:string):void {
        $(this.selectors.publicKey).html(val);
    }

    public updateEOSBalance(eosBalance:string):void {
        $(this.selectors.eosBalance).text(parseFloat(eosBalance).toFixed(4));
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    private attachEventHandlers():void {

        $(this.selectors.mainNetSelected).on("click", (event) => {
            $(this.selectors.networkMenuDropdown).text("MainNet");
            let evt:CustomEvent = new CustomEvent("selectNetwork", {"detail": "mainnet"});
            document.dispatchEvent(evt);
        });

        $(this.selectors.jungleSelected).on("click", (event) => {
            $(this.selectors.networkMenuDropdown).text("Jungle");
            let evt:CustomEvent = new CustomEvent("selectNetwork", {"detail": "jungle"});
            document.dispatchEvent(evt);
        });

        $(this.selectors.rollUnderButton).on("click", (event) => {
            let rollUnderVal:number = <number> $(this.selectors.betSlider).val();

            let val:string = <string> $(this.selectors.betAmount).val();
            let valFloat:number = parseFloat(val);
            if (isNaN(valFloat)) {
                // TODO Reflect error to user
                return false;
            }

            let payload:any = {"detail": {"rollUnder": rollUnderVal, "betAmount": valFloat}};
            let evt:CustomEvent = new CustomEvent("rollUnder", payload);
            document.dispatchEvent(evt);
        });

        $(this.selectors.loginButton).on("click", (event) => {
            let evt:CustomEvent = new CustomEvent("logIn", {"detail": ""});
            document.dispatchEvent(evt);
        });

        $(this.selectors.logoutButton).on("click", (event) => {
            let evt:CustomEvent = new CustomEvent("logOut", {"detail": ""});
            document.dispatchEvent(evt);
        });

        $(this.selectors.betAmount).on("keypress", (event) => {
            var charCode:number = (event.which) ? event.which : event.keyCode;
            if ((charCode > 31 && charCode < 48 && charCode != 46) || charCode > 57) {
                return false;
            }
            return true;
        });
    }

    protected setLoggedInView(account:any, accountInfo:any):void {
        super.setLoggedInView(account, accountInfo);

        $(this.selectors.loggedInView).removeClass("d-none");
        $(this.selectors.loggedOutView).addClass("d-none");
        if (accountInfo) {

            let publicKey:string = Config.firstActivePublicKeyFromAccountInfo(accountInfo);
            if (publicKey) {
                $(this.selectors.publicKey).html(publicKey);
            }

            // let spaceLoc:number = accountInfo.core_liquid_balance.indexOf(" ");
            // let eosBalance:string = (spaceLoc > 0) ? accountInfo.core_liquid_balance.substr(0, spaceLoc) : accountInfo.core_liquid_balance;
            // eosBalance = parseFloat(eosBalance).toFixed(4);
            // $(this.selectors.eosBalance).text(eosBalance);

            $(this.selectors.accountName).html(accountInfo.account_name);
        }
    }

    protected setLoggedOutView():void {
        super.setLoggedOutView();
        $(this.selectors.loggedInView).addClass("d-none");
        $(this.selectors.loggedOutView).removeClass("d-none");
        $(this.selectors.publicKey).html("");
        $(this.selectors.accountName).html("");
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