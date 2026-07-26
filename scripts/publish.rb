#!/usr/bin/env ruby

if File.exist?('index.zip')
  File.delete('index.zip')
end

puts "Creating deployment package..."
# Create zip file excluding unnecessary files
system(%q{zip -r index.zip . -x"*.env" -x".git/*" -x"dynamodb_local_latest/*" -x"node_modules/typescript/*" -x"*.md" -x"scripts/*"}) or abort("Failed to create zip file")

puts "Deploying to AWS Lambda..."
system("aws lambda update-function-code --function-name spotify-playlist-dev --zip-file fileb://index.zip") or abort("Failed to deploy to Lambda")

File.delete('index.zip')

puts "Deployment complete!"
