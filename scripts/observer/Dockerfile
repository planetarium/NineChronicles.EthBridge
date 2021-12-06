FROM python:3.10-alpine

ADD . .

RUN python3 -m pip install -r requirements.txt

ENTRYPOINT ["python3", "__main__.py"]