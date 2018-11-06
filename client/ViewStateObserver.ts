import {ViewState} from "./Config";

export class ViewStateObserver {

    protected account = null;
    protected accountInfo:any = null;

    constructor() {
        this.attachGUIHandlers();
    }

    // ========================================================================
    // PROTECTED METHODS
    // ========================================================================

    protected setLoggedInView(account:any, accountInfo:any):void {
        this.account = account;
        this.accountInfo = accountInfo;
    }

    protected setLoggedOutView():void {
        this.accountInfo = null;
    }

    protected socketConnected():void {

    }

    protected attachGUIHandlers():void {

        // Update our view state
        $(document).on("updateViewState", (event) => {
            let data: any = event.detail;
            switch (data.viewState) {
                case ViewState.LOGGED_IN:
                    this.setLoggedInView(data.account, data.accountInfo);
                    break;
                case ViewState.LOGGED_OUT:
                    this.setLoggedOutView();
                    break;
            }
        });

        // Update our view state
        $(document).on("apiServerConnect", (event) => {
            this.socketConnected();
        });
    }
}