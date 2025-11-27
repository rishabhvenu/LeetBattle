threads_count = Integer(ENV['RAILS_MAX_THREADS'])
process_count = Integer(ENV['RAILS_SERVER_PROCESSES'])
threads threads_count, threads_count
workers process_count

# Increase worker boot timeout to allow for database connections and initialization
worker_boot_timeout 120

port ENV['PORT']
environment ENV['RAILS_ENV']

plugin :tmp_restart