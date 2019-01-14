declare var grecaptcha: any;

export class Greg {
    constructor() {

        window.addEventListener('load', (event) => {
            alert('hi there greg');

            grecaptcha.ready(function () {
                alert('about to call execute');
                grecaptcha.execute('6Ld7tokUAAAAAFycH1ZHemkgBtNtjGR8JVcwfzDk', {action: 'homepage'}).then(function (token) {
                    alert('back');
                });
            });
        });
    }
}

let greg = new Greg()
