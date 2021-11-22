# 0 什么是 ELK

ELK 即 Elasticsearch， Logstash，Kibana 三个开源项目的首字母缩写，其中

- Elasticsearch 是一个搜索和分析引擎
- Logstash 是一个服务器端数据处理管道，它同时从多个来源获取数据，对其进行转换，然后将其发送到像 Elasticsearch 这样的“stash”
- Kibana 允许用户在 Elasticsearch 中使用图表和图形来可视化数据

![image.png](https://cdn.nlark.com/yuque/0/2021/png/749250/1637045902082-f9d0fd3a-727a-4b80-ad82-9da5acfc53a6.png#crop=0&crop=0&crop=1&crop=1&height=464&id=M9uxt&margin=%5Bobject%20Object%5D&name=image.png&originHeight=927&originWidth=919&originalType=binary&ratio=1&rotation=0&showTitle=false&size=125655&status=done&style=none&title=&width=460)

# 1 需求背景

项目需求，需要从多个环境中收集日志，实现以下效果：

- 日志集中化管理
- 日志多维度检索
- 一定的可视化功能

# 2 方案

ELK 很容易实现以上需求，这里我们采用了[Filebeat](https://www.elastic.co/beats/filebeat)收集日志文件，可视化可以增加一个[grafana](https://grafana.com/)做出更好的效果

## 2.1 方案图

## 2.2 组件功能

- Filebeat 日志文件收集，并且推送到 Logstash
- Logstash 通过正则策略配置，对日志内容进行处理后，存储到 elasticsearch
- Elasticsearch 数据库，数据存储与检索
- Kibana, Grafana 可视化

# 3 部署

已有环境是一台 CentOS 主机，ELK 部署选用了 docker-compose 方案，这里直接选用了开源 docker-compose 脚本

## 3.1 安装 Docker & docker-compose

这里不再赘述，直接照官网 step by step: [https://docs.docker.com/engine/install/](https://docs.docker.com/engine/install/)

- 配置 docker 仓库

```bash
sudo yum install -y yum-utils

sudo yum-config-manager \
    --add-repo \
    https://download.docker.com/linux/centos/docker-ce.repo
```

- 安装 docker engine

```bash
sudo yum install docker-ce docker-ce-cli containerd.io
```

- 启动 & 开启自启

```bash
sudo systemctl start docker
sudo systemctl enable docker
```

一波操作之后就装好了，我们来康康是不是正常运行

```bash
[root@localhost ~]# docker version
Client: Docker Engine - Community
 Version:           20.10.10
 API version:       1.41
 Go version:        go1.16.9
 Git commit:        b485636
 Built:             Mon Oct 25 07:44:50 2021
 OS/Arch:           linux/amd64
 Context:           default
 Experimental:      true

Server: Docker Engine - Community
 Engine:
  Version:          20.10.10
  API version:      1.41 (minimum version 1.12)
  Go version:       go1.16.9
  Git commit:       e2f740d
  Built:            Mon Oct 25 07:43:13 2021
  OS/Arch:          linux/amd64
  Experimental:     false
 containerd:
  Version:          1.4.11
  GitCommit:        5b46e404f6b9f661a205e28d59c982d3634148f8
 runc:
  Version:          1.0.2
  GitCommit:        v1.0.2-0-g52b36a2
 docker-init:
  Version:          0.19.0
  GitCommit:        de40ad0

```

好的，完美

- 安装 docker-compose：[https://docs.docker.com/compose/install/](https://docs.docker.com/compose/install/)

```bash
sudo curl -L "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

## 3.2 安装 ELK

安装 elk 的 docker-compose 在 github 上有很多，这里我们用 github star 数最多的开源 compose

- 下载 docker-elk

```bash
git clone https://github.com/deviantony/docker-elk
# 如果clone不下来，也可以直接去https://github.com/deviantony/docker-elk上下载
```

- 如果想要开机自起，也可以使用这个 compose: [https://github.com/zhlicen/docker-elk](https://github.com/zhlicen/docker-elk)
- 定制版本，可以编辑 docker-elk/.env 文件配置所需的版本，这里我们用最新的发布版本 7.15.2，具体版本 tag 可以登陆 elastic docker[仓库](https://www.docker.elastic.co/r/elasticsearch)查看

```bash
cd docker-elk
vi .env

ELK_VERSION=7.15.2
```

- 构建 docker-compose

```bash
cd docker-elk
docker-compose up -d
```

- 如果你网络没问题，正常应该完成了，可以检查各组件监听的 http 端口

```bash
[root@localhost ~]# docker ps
CONTAINER ID   IMAGE                      COMMAND                  CREATED         STATUS          PORTS                                                                                                                                                                        NAMES
050bce896597   docker-elk_kibana          "/bin/tini -- /usr/l…"   2 minutes ago   Up 34 seconds   0.0.0.0:5601->5601/tcp, :::5601->5601/tcp                                                                                                                                    docker-elk_kibana_1
e827c14f49f4   docker-elk_logstash        "/usr/local/bin/dock…"   2 minutes ago   Up 34 seconds   0.0.0.0:5000->5000/tcp, :::5000->5000/tcp, 0.0.0.0:5044->5044/tcp, :::5044->5044/tcp, 0.0.0.0:9600->9600/tcp, 0.0.0.0:5000->5000/udp, :::9600->9600/tcp, :::5000->5000/udp   docker-elk_logstash_1
8a50d54de847   docker-elk_elasticsearch   "/bin/tini -- /usr/l…"   2 minutes ago   Up 34 seconds   0.0.0.0:9200->9200/tcp, :::9200->9200/tcp, 0.0.0.0:9300->9300/tcp, :::9300->9300/tcp                                                                                         docker-elk_elasticsearch_1

```

| **Component** | **端口**       | **其它**                   |
| ------------- | -------------- | -------------------------- |
| ElasticSearch | 9200,9300      |                            |
| Logstash      | 5000,5044,9600 |                            |
| Kibana        | 5601           | 默认账户: elastic/changeme |

- 访问 Kibana：http://{ip}:5601

![image.png](https://cdn.nlark.com/yuque/0/2021/png/749250/1637055358710-87d89579-020b-45bb-b466-f5161bb07d38.png#clientId=u6f785cf8-fbf6-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=841&id=u52b6a028&margin=%5Bobject%20Object%5D&name=image.png&originHeight=841&originWidth=958&originalType=binary&ratio=1&rotation=0&showTitle=false&size=104560&status=done&style=none&taskId=u2b697a7f-7dab-486d-b896-9e41bf82020&title=&width=958)

- 安装 filebeat，filebeat 需要安装在日志所在的环境，同样按照[官网](https://www.elastic.co/guide/en/beats/filebeat/current/setup-repositories.html)操作即可，这里我们使用了 yum 安装

```bash
# 安装
sudo yum install filebeat
# 开机自启
sudo systemctl enable filebeat
```

- 安装 grafana

# 4 配置

Logstash 是用来处理日志的，因此我们优先配置 Logstash，再配置 Filebeat 将数据导入 Logstash

## 4.1 Logstash

- 基础配置，主要包含一些连接信息，默认配置已经在 docker-elk/logstash/config/logstash.yml 目录写好，正常无需修改，修改后需要重启程序才能生效

```bash
# docker-elk/logstash/config/logstash.yml
---
## Default Logstash configuration from Logstash base image.
## https://github.com/elastic/logstash/blob/master/docker/data/logstash/config/logstash-full.yml
#
# 备注：输入-监听地址
http.host: "0.0.0.0"
# 备注：输出-elasticsearch 地址及凭证
xpack.monitoring.elasticsearch.hosts: [ "http://elasticsearch:9200" ]

## X-Pack security credentials
#
xpack.monitoring.enabled: true
xpack.monitoring.elasticsearch.username: elastic
xpack.monitoring.elasticsearch.password: changeme

```

- 处理流 Pipeline 配置
  - Logstash 的 Pipeline 分为 3 个阶段： Inputs 输入 -> Filters 过滤器 -> Outputs 输出

![image.png](https://cdn.nlark.com/yuque/0/2021/png/749250/1637057253117-9c7e30cb-0526-4bc6-ad24-a1566ffcb2c4.png#clientId=u6f785cf8-fbf6-4&crop=0&crop=0&crop=1&crop=1&from=paste&height=122&id=Zz0p1&margin=%5Bobject%20Object%5D&name=image.png&originHeight=243&originWidth=1089&originalType=binary&ratio=1&rotation=0&showTitle=false&size=43478&status=done&style=none&taskId=u8ef2744b-030b-4ce8-ba06-f3218e30e94&title=&width=545)

- 输入支持以下一些类型
  | **类型** | **说明** |
  | --- | --- |
  | file | 直接从操作系统读取文件，类似于 unix 系统中的 tail -0f 命令读取文件 |
  | syslog | 基于 RFC3164 规范，监听 514 端口来接收和解析 syslog 格式的消息 |
  | redis | 从 redis 数据库中读取数据 |
  | beats | 处理从[Beats](https://www.elastic.co/downloads/beats)接收的事件，我们这里选用了 filebeat，Beats 中的一种 |

- 过滤器支持以下一些类型
  | **类型** | **说明** |
  | --- | --- |
  | grok | 解析组织任何文本，Logstash 内建了超过 120 种正则用于日志解析，grok 语法可以在这里在线调试：[http://grokdebug.herokuapp.com](http://grokdebug.herokuapp.com) |
  | mutate | 主要用来转换日志格式，你可以使用它对日志进行重命名，删除，替换，修改字段等操作 |
  | drop | 丢弃事件 |
  | clone | 复制一个日志，一般用于删除或增加字段 |
  | geoip | 用于给日志增加 IP 地理位置，主要用来在 kibana 上展示 |

- 输出支持一下一些类型
  | **类型** | **说明** |
  | --- | --- |
  | elasticsearch | 将日志传送到 Elasticsearch |
  | file | 写到文件 |
  | graphite | 将数据传送到 graphite，[http://graphite.readthedocs.io/en/latest/](http://graphite.readthedocs.io/en/latest/) |
  | statsd | 将数据传送到 statsd |

- 在 docker-elk/logstash/pipeline/logstash.conf 已经默认配置好了基于 filebeat 和 elasticsearch 的配置，如下，所以我们只需要配置 Filters 即可

```bash
# 输入配置
input {
        beats {
                port => 5044
        }

        tcp {
                port => 5000
        }
}

## Add your filters / logstash plugins configuration here
# 过滤器配置

# 输出配置
output {
        elasticsearch {
                hosts => "elasticsearch:9200"
                user => "elastic"
                password => "changeme"
                ecs_compatibility => disabled
        }
}

```

- Filters 配置，详细的配置教程参考官网([https://www.elastic.co/guide/en/logstash/7.15/configuration-file-structure.html](https://www.elastic.co/guide/en/logstash/7.15/configuration-file-structure.html))即可，我们这里主要以例子来说明
- 我们这里使用外联方式来插入 Filter，所以我们修改 logstash.conf

```bash
# 输入配置
input {
        beats {
                port => 5044
        }

        tcp {
                port => 5000
        }
}

## Add your filters / logstash plugins configuration here
# 过滤器配置
# 引用外部文件

# 输出配置
output {
        elasticsearch {
                hosts => "elasticsearch:9200"
                user => "elastic"
                password => "changeme"
                ecs_compatibility => disabled
        }
}

```

- Logstash Pipline 使用 GROK 语法进行日志解析，可以使用正则匹配出我们日志中的内容，转换为关键字，存入 Elasticsearch 方便检索
- 配置 GROK 的时候，我们可以使用在线 Debugger 来调试我们的正则：[https://grokdebug.herokuapp.com/](https://grokdebug.herokuapp.com/)

## 4.2 Filebeat

- Filebeat 默认配置文件：/etc/filebeat/filebeat.yml
- 需要配置的部分主要是输入[filebeat.inputs] 和 输出[output.logstash]

```yaml
###################### Filebeat Configuration Example #########################

# This file is an example configuration file highlighting only the most common
# options. The filebeat.reference.yml file from the same directory contains all the
# supported options with more comments. You can use it as a reference.
#
# You can find the full configuration reference here:
# https://www.elastic.co/guide/en/beats/filebeat/index.html

# For more available modules and options, please see the filebeat.reference.yml sample
# configuration file.

#=========================== Filebeat inputs =============================

filebeat.inputs:
  # Each - is an input. Most options can be set at the input level, so
  # you can use different inputs for various configurations.
  # Below are the input specific configurations.

  - type: log

    # Change to true to enable this input configuration.
    enabled: true

    # Paths that should be crawled and fetched. Glob based paths.
    paths:
      # 在这里配置输入的文件
      - /var/log/xxxx/aaa/*.log
      - /var/log/xxxx/bbb/*.log

      #- c:\programdata\elasticsearch\logs\*

    # Exclude lines. A list of regular expressions to match. It drops the lines that are
    # matching any regular expression from the list.
    #exclude_lines: ['^DBG']

    # Include lines. A list of regular expressions to match. It exports the lines that are
    # matching any regular expression from the list.
    #include_lines: ['^ERR', '^WARN']

    # Exclude files. A list of regular expressions to match. Filebeat drops the files that
    # are matching any regular expression from the list. By default, no files are dropped.
    #exclude_files: ['.gz$']

    # Optional additional fields. These fields can be freely picked
    # to add additional information to the crawled log files for filtering
    #fields:
    #  level: debug
    #  review: 1

    ### Multiline options

    # Multiline can be used for log messages spanning multiple lines. This is common
    # for Java Stack Traces or C-Line Continuation

    # The regexp Pattern that has to be matched. The example pattern matches all lines starting with [
    #multiline.pattern: ^\[

    # Defines if the pattern set under pattern should be negated or not. Default is false.
    #multiline.negate: false

    # Match can be set to "after" or "before". It is used to define if lines should be append to a pattern
    # that was (not) matched before or after or as long as a pattern is not matched based on negate.
    # Note: After is the equivalent to previous and before is the equivalent to to next in Logstash
    #multiline.match: after

#============================= Filebeat modules ===============================

filebeat.config.modules:
  # Glob pattern for configuration loading
  path: ${path.config}/modules.d/*.yml

  # Set to true to enable config reloading
  reload.enabled: false

  # Period on which files under path should be checked for changes
  #reload.period: 10s

#==================== Elasticsearch template setting ==========================

setup.template.settings:
  index.number_of_shards: 1
  #index.codec: best_compression
  #_source.enabled: false

#================================ General =====================================

# The name of the shipper that publishes the network data. It can be used to group
# all the transactions sent by a single shipper in the web interface.
#name:

# The tags of the shipper are included in their own field with each
# transaction published.
#tags: ["service-X", "web-tier"]

# Optional fields that you can specify to add additional information to the
# output.
#fields:
#  env: staging

#============================== Dashboards =====================================
# These settings control loading the sample dashboards to the Kibana index. Loading
# the dashboards is disabled by default and can be enabled either by setting the
# options here or by using the `setup` command.
#setup.dashboards.enabled: false

# The URL from where to download the dashboards archive. By default this URL
# has a value which is computed based on the Beat name and version. For released
# versions, this URL points to the dashboard archive on the artifacts.elastic.co
# website.
#setup.dashboards.url:

#============================== Kibana =====================================

# Starting with Beats version 6.0.0, the dashboards are loaded via the Kibana API.
# This requires a Kibana endpoint configuration.
setup.kibana:

  # Kibana Host
  # Scheme and port can be left out and will be set to the default (http and 5601)
  # In case you specify and additional path, the scheme is required: http://localhost:5601/path
  # IPv6 addresses should always be defined as: https://[2001:db8::1]:5601
  #host: "localhost:5601"

  # Kibana Space ID
  # ID of the Kibana Space into which the dashboards should be loaded. By default,
  # the Default Space will be used.
  #space.id:

#============================= Elastic Cloud ==================================

# These settings simplify using Filebeat with the Elastic Cloud (https://cloud.elastic.co/).

# The cloud.id setting overwrites the `output.elasticsearch.hosts` and
# `setup.kibana.host` options.
# You can find the `cloud.id` in the Elastic Cloud web UI.
#cloud.id:

# The cloud.auth setting overwrites the `output.elasticsearch.username` and
# `output.elasticsearch.password` settings. The format is `<user>:<pass>`.
#cloud.auth:

#================================ Outputs =====================================

# Configure what output to use when sending the data collected by the beat.

#-------------------------- Elasticsearch output ------------------------------
#output.elasticsearch:
# Array of hosts to connect to.
#  hosts: ["localhost:9200"]

# Protocol - either `http` (default) or `https`.
#protocol: "https"

# Authentication credentials - either API key or username/password.
#api_key: "id:api_key"
#username: "elastic"
#password: "changeme"

#----------------------------- Logstash output --------------------------------
output.logstash:
  # The Logstash hosts
  # 在这里配置logstash的地址
  hosts: ["192.168.35.96:5044"]

  # Optional SSL. By default is off.
  # List of root certificates for HTTPS server verifications
  #ssl.certificate_authorities: ["/etc/pki/root/ca.pem"]

  # Certificate for SSL client authentication
  #ssl.certificate: "/etc/pki/client/cert.pem"

  # Client Certificate Key
  #ssl.key: "/etc/pki/client/cert.key"

#================================ Processors =====================================

# Configure processors to enhance or manipulate events generated by the beat.

processors:
  - add_host_metadata: ~
  - add_cloud_metadata: ~
  - add_docker_metadata: ~
  - add_kubernetes_metadata: ~
#================================ Logging =====================================

# Sets log level. The default log level is info.
# Available log levels are: error, warning, info, debug
#logging.level: debug

# At debug level, you can selectively enable logging only for some components.
# To enable all selectors use ["*"]. Examples of other selectors are "beat",
# "publish", "service".
#logging.selectors: ["*"]

#============================== X-Pack Monitoring ===============================
# filebeat can export internal metrics to a central Elasticsearch monitoring
# cluster.  This requires xpack monitoring to be enabled in Elasticsearch.  The
# reporting is disabled by default.

# Set to true to enable the monitoring reporter.
#monitoring.enabled: false

# Sets the UUID of the Elasticsearch cluster under which monitoring data for this
# Filebeat instance will appear in the Stack Monitoring UI. If output.elasticsearch
# is enabled, the UUID is derived from the Elasticsearch cluster referenced by output.elasticsearch.
#monitoring.cluster_uuid:

# Uncomment to send the metrics to Elasticsearch. Most settings from the
# Elasticsearch output are accepted here as well.
# Note that the settings should point to your Elasticsearch *monitoring* cluster.
# Any setting that is not set is automatically inherited from the Elasticsearch
# output configuration, so if you have the Elasticsearch output configured such
# that it is pointing to your Elasticsearch monitoring cluster, you can simply
# uncomment the following line.
#monitoring.elasticsearch:

#================================= Migration ==================================

# This allows to enable 6.7 migration aliases
#migration.6_to_7.enabled: true
```

- 配置好之后重启 filebeat 即可生效

```bash
systemctl restart filebeat
```

- filebeat 会记录读取文件的指针，增量读取，如果在测试过程中需要清理 filebeat 的 cache，重新读取所有文件，可以删除 registry

```bash
# 停止filebeat
sudo systemctl stop filbeat
# 备份registry
mv /var/lib/filebeat/registry /var/lib/filebeat/registry.old
# 重启后会重新生成registry
sudo systemctl start filbeat
```

- logstash
- 定时清理策略

由于日志持续存在，长时间写会导致磁盘写满
