#!/usr/bin/env ruby

# Deploys the Lambda onto the Bun custom-runtime layer.
#
# Bun executes the TypeScript in src/ directly, so there is no tsc step and no
# dist/ — the handler is src/lambda-bun.fetch, which adapts the layer's
# Request/Response contract onto the APIGatewayProxyHandler in src/index.ts.
#
# The package is assembled in a staging directory with a production-only
# install rather than zipping the working tree. That keeps devDependencies
# (typescript alone is ~20MB) out of the upload and means a stray local file
# can never ride along to production.

require 'fileutils'
require 'json'

FUNCTION = 'spotify-playlist-dev'
REGION = 'us-east-1'
LAYER = 'arn:aws:lambda:us-east-1:495671805917:layer:bun:2'.freeze
RUNTIME = 'provided.al2023'.freeze
HANDLER = 'src/lambda-bun.fetch'.freeze
ARCH = 'arm64'.freeze

# Bun's baseline footprint is much larger than Node's: the read-only `user`
# action alone peaked at 115MB of the 128MB this function ran on under
# nodejs20.x. Set explicitly so the requirement stays visible — the heavy path
# (frequent-crawling, which opens with a full table scan) needs the headroom.
MEMORY = 512

ROOT = File.expand_path('..', __dir__)
STAGE = File.join(ROOT, 'build', 'lambda')
ZIP = File.join(ROOT, 'index.zip')

# Copied into the package as-is. src/ carries the TypeScript Bun will run;
# package.json + bun.lock drive the production install.
PAYLOAD = ['src', 'package.json', 'bun.lock', 'tsconfig.json'].freeze

# Present in src/ but useless on Lambda.
PRUNE = ['src/__tests__', 'src/scripts', 'src/migrations'].freeze

def run(command, failure)
  puts "  $ #{command}"
  system(command) or abort("\n!! #{failure}")
end

def aws(args, failure)
  run("aws #{args} --region #{REGION}", failure)
end

Dir.chdir(ROOT)

puts 'Staging package...'
FileUtils.rm_rf(STAGE)
FileUtils.mkdir_p(STAGE)
PAYLOAD.each do |path|
  abort("!! missing #{path}") unless File.exist?(path)
  FileUtils.cp_r(path, STAGE)
end
PRUNE.each { |path| FileUtils.rm_rf(File.join(STAGE, path)) }

puts 'Installing production dependencies...'
Dir.chdir(STAGE) do
  run('bun install --production --frozen-lockfile', 'bun install failed')
end

puts 'Creating deployment package...'
File.delete(ZIP) if File.exist?(ZIP)
Dir.chdir(STAGE) do
  run(%(zip -r -q "#{ZIP}" . -x "*.DS_Store" -x "**/.env"), 'Failed to create zip file')
end
puts "  #{(File.size(ZIP) / 1024.0 / 1024.0).round(1)}MB"

# Code and configuration cannot be updated in one API call, so the function is
# briefly mismatched between these two steps. Code goes first: an old-runtime
# function pointed at a package with no dist/ fails the same way as a
# new-runtime function pointed at a package with no handler, and this ordering
# leaves the function correct the moment the second call lands.
puts 'Uploading code...'
aws("lambda update-function-code --function-name #{FUNCTION} " \
    "--zip-file fileb://#{ZIP} --architectures #{ARCH} --no-cli-pager --output json",
    'Failed to upload code')
aws("lambda wait function-updated-v2 --function-name #{FUNCTION}", 'Function never settled')

puts 'Switching runtime to Bun...'
aws("lambda update-function-configuration --function-name #{FUNCTION} " \
    "--runtime #{RUNTIME} --handler #{HANDLER} --layers #{LAYER} " \
    "--memory-size #{MEMORY} --no-cli-pager --output json",
    'Failed to update configuration')
aws("lambda wait function-updated-v2 --function-name #{FUNCTION}", 'Function never settled')

File.delete(ZIP) if File.exist?(ZIP)
FileUtils.rm_rf(STAGE)

puts "\nDeployment complete!"
puts "  runtime: #{RUNTIME} (#{ARCH})"
puts "  handler: #{HANDLER}"
puts "  layer:   #{LAYER}"
