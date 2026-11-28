#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <AsyncWebSocket.h>
#include <ESP32Servo.h>
#include <ArduinoJson.h>

const char* ssid = "YOUR_SSID";
const char* password = "YOUR_PASSWORD";

Servo panServo;
Servo tiltServo;

const int PAN_PIN = 18;
const int TILT_PIN = 19;
const int RED_PIN = 25;
const int GREEN_PIN = 26;
const int BLUE_PIN = 27;

AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

void setup() {
  Serial.begin(115200);

  panServo.attach(PAN_PIN);
  tiltServo.attach(TILT_PIN);

  ledcSetup(0, 5000, 8);
  ledcSetup(1, 5000, 8);
  ledcSetup(2, 5000, 8);
  ledcAttachPin(RED_PIN, 0);
  ledcAttachPin(GREEN_PIN, 1);
  ledcAttachPin(BLUE_PIN, 2);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) delay(500);
  Serial.println(WiFi.localIP());

  ws.onEvent(onWsEvent);
  server.addHandler(&ws);
  server.begin();
}

void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
               AwsEventType type, void *arg, uint8_t *data, size_t len) {
  if (type == WS_EVT_DATA) {
    StaticJsonDocument<200> doc;
    deserializeJson(doc, data, len);

    int pan = doc["pan"] | 90;
    int tilt = doc["tilt"] | 90;
    int r = doc["r"] | 0;
    int g = doc["g"] | 0;
    int b = doc["b"] | 0;
    int intensity = doc["intensity"] | 255;

    panServo.write(constrain(pan, 0, 180));
    tiltServo.write(constrain(tilt, 0, 180));

    ledcWrite(0, (r * intensity) / 255);
    ledcWrite(1, (g * intensity) / 255);
    ledcWrite(2, (b * intensity) / 255);
  }
}

void loop() {
  ws.cleanupClients();
}
