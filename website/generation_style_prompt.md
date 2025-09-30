Мне нужно, чтобы ты сгенерировал содержимое для файла `style.css` с учётом разработанных `index.html` и `client.js`. Пишу только ключевые требования, до которых смог додуматься сам:
- Поскольку я хочу видеть страницу в тёмной цветовой схеме, основной текст будет белым. Сделай выравнивание по левому краю и мелкий шрифт. При этом учти, что все переносы на новую строку должны корректно отображаться.
- Элементы страницы должны быть стилизованы так, что в итоге они растянутся и займут всю ширину экрана.
- Не делай чат пролистываемым, пусть высота страницы растёт с каждым контейнером сообщения — формироваться будет как башня.
- Учти удобства использования на мобильных устройствах. Я решил собирать `messageBlock` из `containerForDeleteButton` и `containerForContent`, чтобы никогда не получилось так, что кнопка удаления перекрывает собой текстовое содержимое. Разделение по частям нужно, чтобы они обтекали, не наезжая друг на друга. `containerForDeleteButton` можно сделать тёмно-жёлтым раз уж это отдельный элемент — будет как шапка сообщения. Сама кнопка должна быть красной.
- Текст для индикаторов ввода, а также ответа сервера может иметь три форматирования: красный, жёлтый и зелёный.
- Сообщения от роли "Система" будут отображены на пурпурном фоне, для "Ассистент" — бирюзовый, "Пользователь" — синий. Важно при этом подобрать более тёмный цвет.

```html
<!DOCTYPE html>
<html lang="ru">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>MySQL Database Assistant</title>
	<link rel="stylesheet" href="style.css">
</head>
<body>
	<div class="container">
		<h1>MySQL Database Assistant</h1>

		<section class="section">
			<h2>История чата</h2>
			<div id="chatHistory" class="chat-history">
				<p>Чтобы выполнить загрузку истории чата, требуется обновить данные, получив доступ к серверу.</p>
			</div>
		</section>

		<section class="section">
			<h2>Пользовательский ввод</h2>
			<div class="input-group">
				<h3>Пароль:</h3>
				<input type="password" id="passwordInput">
				<span id="passwordIndicator" class="indicator-text"></span>
			</div>
			<div class="input-group">
				<h3>Сообщение:</h3>
				<textarea id="messageInput"></textarea>
				<span id="messageIndicator" class="indicator-text"></span>
			</div>
			<div class="button-group">
				<button id="refreshButton">Обновить</button>
				<button id="sendButton">Отправить</button>
				<button id="changeApiKeyButton">Сменить API-ключ</button>
				<button id="generateButton">Сгенерировать</button>
			</div>
		</section>

		<section class="section">
			<h2>Ответ сервера</h2>
			<span id="serverResponse" class="indicator-text"></span>
		</section>
	</div>

	<footer>
		<p>&copy; Exateym, 2025 | <a href="https://github.com/Exateym" target="_blank" rel="noopener noreferrer">GitHub</a></p>
	</footer>

	<script src="client.js"></script>
</body>
</html>
```

```javascript
// ===== Поиск элементов на веб-странице и глобальные переменные =====

const chatHistory = document.getElementById('chatHistory');
const passwordInput = document.getElementById('passwordInput');
const passwordIndicator = document.getElementById('passwordIndicator');
const messageInput = document.getElementById('messageInput');
const messageIndicator = document.getElementById('messageIndicator');
const refreshButton = document.getElementById('refreshButton');
const sendButton = document.getElementById('sendButton');
const changeApiKeyButton = document.getElementById('changeApiKeyButton');
const generateButton = document.getElementById('generateButton');
const serverResponse = document.getElementById('serverResponse');

let userChatHash;



// ===== Динамическое отображение числа введённых символов =====

function simplificationNumeral(number) {
	if (number > 19 && number < 100) {
		return number % 10;
	}
	if (number > 99) {
		number = number % 100;
		if (number > 19 && number < 100) {
			return number % 10;
		}
	}
	return number;
}

/**
 * Спрягает существительное с числительным.
 * @param {Number} number Число, с которым будет спрягаться существительное.
 * @param {String} foundation Неизменяемая часть слова.
 * @param {String} additionOne Продолжение слова, которое будет использовано, когда число равно 0 или больше 4.
 * @param {String} additionTwo Продолжение слова, которое будет использовано, когда число равно 1.
 * @param {String} additionThree Продолжение слова, которое будет использовано, когда число равно 2, 3 или 4.
 */
function matchWord(number, foundation, additionOne, additionTwo, additionThree) {
	number = simplificationNumeral(number);
	if (number == 0 || number > 4) {
		return foundation + additionOne;
	}
	if (number == 1) {
		return foundation + additionTwo;
	}
	return foundation + additionThree;
}

function setupInputIndicator(inputElement, indicatorElement) {
	inputElement.addEventListener('input', () => {
		const quantity = inputElement.value.length;
		if (quantity === 0) {
			indicatorElement.className = 'text-red';
			indicatorElement.textContent = 'Поле является обязательным для заполнения.';
		} else {
			indicatorElement.className = 'text-yellow';
			indicatorElement.textContent = `Ввод содержит ${quantity} ${matchWord(quantity, 'символ', 'ов', '', 'а')}.`;
		}
	});
}



// ===== Вспомогательные функции =====

function getTimestamp(timestamp = Date.now()) {
	const givenTime = new Date(timestamp)
	const days = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
	const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };
	const hours = givenTime.getHours();
	let sector;
	if (hours === 23 || hours === 0) {
		sector = 'Ночь';
	} else if (hours >= 1 && hours <= 5) {
		sector = 'Глубокая ночь';
	} else if (hours >= 6 && hours <= 8) {
		sector = 'Раннее утро';
	} else if (hours >= 9 && hours <= 11) {
		sector = 'Утро';
	} else if (hours >= 12 && hours <= 16) {
		sector = 'День';
	} else if (hours >= 17 && hours <= 20) {
		sector = 'Вечер';
	} else {
		sector = 'Поздний вечер';
	}
	return `[${new Intl.DateTimeFormat('ru-RU', options).format(givenTime)} — ${days[givenTime.getDay()]}, ${sector}]`;
}

function handleSuccess(data) {
	serverResponse.className = 'text-green';
	serverResponse.textContent = `${getTimestamp()} ${data.message}`;
}

function handleError(data, error) {
	serverResponse.className = 'text-red';
	serverResponse.textContent = `${getTimestamp()} `;
	if (data !== undefined && data.success === false) {
		serverResponse.textContent += data.message;
	} else {
		if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
			serverResponse.textContent += 'Не удалось подключиться к серверу.';
		} else {
			serverResponse.textContent += error.message;
		}
	}
}

function displayChatHistory(chatMessages) {
	chatHistory.textContent = '';
	if (chatMessages.length === 0) {
		chatHistory.textContent = 'История чата не содержит ни одного сообщения.';
	} else {
		chatMessages.forEach(structure => {
			const messageBlock = document.createElement('div');
			messageBlock.classList.add('message-block');

			const containerForDeleteButton = document.createElement('div');
			containerForDeleteButton.classList.add('container-for-delete-button');
			const deleteButton = document.createElement('button');
			deleteButton.textContent = 'Удалить';
			deleteButton.classList.add('delete-button');
			deleteButton.dataset.messageIdentifier = structure.identifier;
			deleteButton.addEventListener('click', async (event) => {
				await fetchDelete(parseInt(event.target.dataset.messageIdentifier, 10));
			});
			containerForDeleteButton.appendChild(deleteButton);

			const containerForContent = document.createElement('div');
			containerForContent.classList.add('container-for-content');
			let roleName;
			if (structure.role === 'assistant') {
				messageBlock.classList.add('role-assistant'); 
				roleName = 'Ассистент';
			} else if (structure.role === 'system') {
				messageBlock.classList.add('role-system');
				roleName = 'Система';
			} else {
				messageBlock.classList.add('role-user');
				roleName = 'Пользователь';
			}
			const metadataHeader = document.createElement('h4');
			metadataHeader.classList.add('metadata-header');
			metadataHeader.textContent = `${roleName} ${getTimestamp(structure.timestamp)} Идентификатор сообщения: «${structure.identifier}»`;
			const contentParagraph = document.createElement('p');
			contentParagraph.classList.add('content-paragraph');
			contentParagraph.textContent = structure.content;
			containerForContent.appendChild(metadataHeader);
			containerForContent.appendChild(contentParagraph);

			messageBlock.appendChild(containerForDeleteButton);
			messageBlock.appendChild(containerForContent);
			chatHistory.appendChild(messageBlock);
		});
	}
}



// ===== Функции для запроса ресурсов сервера и взаимодействия с ним =====

async function fetchHistory() {
	let data;
	try {
		const response = await fetch('/history', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userPassword: passwordInput.value, userChatHash })
		});
		data = await response.json();
		if (data.success === true) {
			handleSuccess(data);
			if (data.history && data.hashcode) {
				displayChatHistory(data.history);
				userChatHash = data.hashcode;
			}
		} else {
			throw new Error('Не вышло получить историю сообщений с сервера.');
		}
	} catch (error) {
		handleError(data, error);
	}
}

async function fetchMessage() {
	let data;
	try {
		const response = await fetch('/message', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userPassword: passwordInput.value, messageContent: messageInput.value })
		});
		data = await response.json();
		if (data.success === true) {
			handleSuccess(data);
			messageInput.value = '';
			messageInput.dispatchEvent(new Event('input'));
		} else {
			throw new Error('Не вышло отправить сообщение на сервер.');
		}
	} catch (error) {
		handleError(data, error);
	}
}

async function fetchDelete(messageIdentifier) {
	let data;
	try {
		const response = await fetch('/delete', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userPassword: passwordInput.value, messageIdentifier })
		});
		data = await response.json();
		if (data.success === true) {
			handleSuccess(data);
		} else {
			throw new Error('Не вышло удалить сообщение из истории чата сервера.');
		}
	} catch (error) {
		handleError(data, error);
	}
}

async function fetchChange() {
	let data;
	try {
		const response = await fetch('/change', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userPassword: passwordInput.value })
		});
		data = await response.json();
		if (data.success === true) {
			handleSuccess(data);
		} else {
			throw new Error('Не вышло поменять используемый API-ключ.');
		}
	} catch (error) {
		handleError(data, error);
	}
}

async function fetchGenerate() {
	let data;
	try {
		const response = await fetch('/generate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userPassword: passwordInput.value })
		});
		data = await response.json();
		if (data.success === true) {
			handleSuccess(data);
		} else {
			throw new Error('Не вышло инициировать генерацию ответа ассистента.');
		}
	} catch (error) {
		handleError(data, error);
	}
}



// ===== Ожидание загрузки гипертекстовой разметки документа и работа с её элементами =====

document.addEventListener('DOMContentLoaded', () => {
	setupInputIndicator(passwordInput, passwordIndicator);
	setupInputIndicator(messageInput, messageIndicator);
	// После перезапуска интернет-браузера некоторые данные полей заполнения могут сохраниться в разметке страницы, а другие — исчезнуть, из-за чего текущий подсчёт станет некорректным.
	const indicatorsUpdateIntervalObject = setInterval(function () {
		passwordInput.dispatchEvent(new Event('input'));
		messageInput.dispatchEvent(new Event('input'));
	}, 1000);

	refreshButton.addEventListener('click', fetchHistory);
	sendButton.addEventListener('click', fetchMessage);
	changeApiKeyButton.addEventListener('click', fetchChange);
	generateButton.addEventListener('click', fetchGenerate);
});
```